/**
 * Escrow: Bidwell holds every payment until the buyer has the item and a dispute window has
 * passed, then pays the seller (minus any platform fee). If the buyer reports a problem, the
 * money is frozen until a Bidwell admin decides to refund the buyer, pay the seller, or let the
 * order carry on.
 *
 * Money only moves through the provider in processPayouts()/processRefunds(), which are safe to
 * run repeatedly. Everything else here is bookkeeping in one SQLite transaction.
 */
import type { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { tx } from "./db.ts";
import { AuctionError, getOrder, requireOrder, setStatus, type Order, type OrderStatus } from "./auctions.ts";
import { formatMoney } from "./money.ts";
import type { PaymentProvider } from "./payments/types.ts";

const HOUR = 3_600_000;

/** Bidwell's cut, in percent of the total the winner pays (winning bid + delivery). */
export function feePercent(): number {
  const n = Number(process.env.PLATFORM_FEE_PERCENT ?? 5);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : 0;
}

export function feeFor(amountCents: number): number {
  return Math.round((amountCents * feePercent()) / 100);
}

export const DISPUTE_REASONS = [
  "Item not received",
  "Item not as described",
  "Item arrived damaged",
  "Wrong item sent",
  "Other",
];

export type Dispute = {
  id: number;
  order_id: number;
  opened_by: number;
  reason: string;
  details: string;
  prev_status: OrderStatus;
  seller_response: string | null;
  status: "open" | "refunded" | "released" | "resumed";
  admin_note: string | null;
  resolved_by: number | null;
  created_at: number;
  resolved_at: number | null;
};

export type Payout = {
  id: number;
  order_id: number;
  seller_id: number;
  gross_cents: number;
  fee_cents: number;
  delivery_fee_cents: number;
  amount_cents: number;
  currency: string;
  status: "waiting_details" | "pending" | "processing" | "paid" | "failed";
  reference: string;
  provider: string | null;
  provider_ref: string | null;
  failure_reason: string | null;
  attempts: number;
  created_at: number;
  updated_at: number;
};

export type Refund = {
  id: number;
  order_id: number;
  payment_reference: string | null;
  provider: string | null;
  amount_cents: number;
  currency: string;
  status: "pending" | "processing" | "processed" | "failed" | "manual";
  provider_ref: string | null;
  failure_reason: string | null;
  created_at: number;
  updated_at: number;
};

export type PayoutAccount = {
  user_id: number;
  method: "bank" | "mobile_money";
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  recipient_code: string | null;
  updated_at: number;
};

function event(db: DatabaseSync, orderId: number, status: string, note: string, now: number) {
  db.prepare(`INSERT INTO order_events (order_id, status, note, created_at) VALUES (?, ?, ?, ?)`).run(orderId, status, note, now);
}

/* --------------------------------- Disputes -------------------------------- */

/**
 * After the delivery partner confirms delivery, the winner says the item is as expected. That
 * ends the dispute window early and releases the money to the seller straight away.
 */
export function acceptItem(db: DatabaseSync, orderId: number, userId: number, now = Date.now()) {
  const o = requireOrder(db, orderId);
  if (o.buyer_id !== userId) throw new AuctionError("Only the winner can accept the item.");
  if (o.status !== "delivered" || o.escrow_status !== "held") throw new AuctionError("You can accept the item once it has been delivered.");
  tx(db, () => {
    db.prepare(`UPDATE orders SET accepted_at = ? WHERE id = ?`).run(now, o.id);
    release(db, o, now, "Winner confirmed the item is in good condition and as described.");
  });
}

export function canDispute(o: Order, now = Date.now()): boolean {
  if (o.status === "paid" || o.status === "shipped" || o.status === "returning") return true;
  return o.status === "delivered" && o.release_at != null && now < o.release_at;
}

/** The buyer reports a problem. The money is frozen until an admin resolves it. */
export function openDispute(
  db: DatabaseSync,
  orderId: number,
  userId: number,
  reason: string,
  details: string,
  now = Date.now()
): number {
  const o = requireOrder(db, orderId);
  if (o.buyer_id !== userId) throw new AuctionError("Only the winner can report a problem with this order.");
  if (o.status === "disputed") throw new AuctionError("There's already an open report for this order.");
  if (!canDispute(o, now)) {
    throw new AuctionError(
      o.status === "delivered" || o.status === "completed"
        ? "The time to report a problem has passed and the seller has been paid."
        : "You can report a problem once you've paid."
    );
  }
  if (!DISPUTE_REASONS.includes(reason)) throw new AuctionError("Choose what went wrong.");
  if (details.trim().length < 10) throw new AuctionError("Describe the problem in a sentence or two.");
  return tx(db, () => {
    const r = db
      .prepare(
        `INSERT INTO disputes (order_id, opened_by, reason, details, prev_status, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(o.id, userId, reason, details.trim().slice(0, 4000), o.status, now);
    db.prepare(`UPDATE orders SET escrow_status = 'frozen' WHERE id = ?`).run(o.id);
    setStatus(db, o.id, "disputed", `Winner reported a problem: ${reason}. Funds are frozen while Bidwell reviews it.`, now);
    return Number(r.lastInsertRowid);
  });
}

export function respondToDispute(db: DatabaseSync, disputeId: number, userId: number, text: string, now = Date.now()) {
  const d = getDispute(db, disputeId);
  if (!d) throw new AuctionError("Report not found.");
  const o = requireOrder(db, d.order_id);
  if (o.seller_id !== userId) throw new AuctionError("Only the seller can respond to this report.");
  if (d.status !== "open") throw new AuctionError("This report has already been resolved.");
  if (!text.trim()) throw new AuctionError("Write your response.");
  tx(db, () => {
    db.prepare(`UPDATE disputes SET seller_response = ? WHERE id = ?`).run(text.trim().slice(0, 4000), d.id);
    event(db, o.id, "disputed", "Seller responded to the report.", now);
  });
}

export type Resolution = "refund" | "release" | "resume";

/**
 * An admin settles a dispute:
 * - refund: the buyer gets their money back
 * - release: the seller is paid now
 * - resume: the order carries on from where it was (e.g. a late parcel that is still coming)
 * The caller must check the user is an admin.
 */
export function resolveDispute(
  db: DatabaseSync,
  disputeId: number,
  adminId: number,
  outcome: Resolution,
  note: string,
  now = Date.now()
) {
  const d = getDispute(db, disputeId);
  if (!d) throw new AuctionError("Report not found.");
  if (d.status !== "open") throw new AuctionError("This report has already been resolved.");
  if (!note.trim()) throw new AuctionError("Add a note explaining the decision. Both sides will see it.");
  const o = requireOrder(db, d.order_id);
  tx(db, () => {
    const status = outcome === "refund" ? "refunded" : outcome === "release" ? "released" : "resumed";
    db.prepare(`UPDATE disputes SET status = ?, admin_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`).run(
      status,
      note.trim(),
      adminId,
      now,
      d.id
    );
    if (outcome === "refund") {
      startRefund(db, o, now, `Bidwell resolved the report in the winner's favour: ${note.trim()}`);
    } else if (outcome === "release") {
      release(db, o, now, `Bidwell resolved the report in the seller's favour: ${note.trim()}`);
    } else {
      if (d.prev_status === "delivered") {
        // Give the buyer a fresh window, since their earlier one was interrupted.
        db.prepare(`UPDATE orders SET escrow_status = 'held', release_at = ? WHERE id = ?`).run(
          now + Number(process.env.DISPUTE_WINDOW_HOURS ?? 6) * HOUR,
          o.id
        );
      } else {
        db.prepare(`UPDATE orders SET escrow_status = 'held' WHERE id = ?`).run(o.id);
      }
      setStatus(db, o.id, d.prev_status, `Bidwell closed the report and the order continues: ${note.trim()}`, now);
    }
  });
}

export function getDispute(db: DatabaseSync, id: number): Dispute | undefined {
  return db.prepare(`SELECT * FROM disputes WHERE id = ?`).get(id) as Dispute | undefined;
}

export function disputesForOrder(db: DatabaseSync, orderId: number): Dispute[] {
  return db.prepare(`SELECT * FROM disputes WHERE order_id = ? ORDER BY id DESC`).all(orderId) as Dispute[];
}

/* --------------------------- Releasing and refunding --------------------------- */

/** How the winner's payment splits when the sale completes. */
export function saleSplit(o: Pick<Order, "total_cents" | "delivery_fee_cents">) {
  const fee = feeFor(o.total_cents);
  return { total: o.total_cents, fee, delivery: o.delivery_fee_cents, seller: o.total_cents - fee - o.delivery_fee_cents };
}

/** How much the winner gets back after a failed delivery: the total less the fee and delivery both ways. */
export function failedDeliverySplit(o: Pick<Order, "total_cents" | "delivery_fee_cents" | "return_fee_cents">) {
  const fee = feeFor(o.total_cents);
  const refund = Math.max(0, o.total_cents - fee - o.delivery_fee_cents - o.return_fee_cents);
  return { total: o.total_cents, fee, delivery: o.delivery_fee_cents, returnFee: o.return_fee_cents, refund };
}

function release(db: DatabaseSync, o: Order, now: number, why: string) {
  const split = saleSplit(o);
  const acct = getPayoutAccount(db, o.seller_id);
  db.prepare(`UPDATE orders SET escrow_status = 'released' WHERE id = ?`).run(o.id);
  db.prepare(
    `INSERT OR IGNORE INTO payouts (order_id, seller_id, gross_cents, fee_cents, delivery_fee_cents, amount_cents, currency, status, reference, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    o.id,
    o.seller_id,
    split.total,
    split.fee,
    split.delivery,
    split.seller,
    currencyOf(db, o),
    acct ? "pending" : "waiting_details",
    `payout-ord${o.id}-${crypto.randomBytes(4).toString("hex")}`,
    now,
    now
  );
  setStatus(
    db,
    o.id,
    "completed",
    `${why} ${formatMoney(split.seller)} released to the seller (${formatMoney(split.total)} paid, less ${formatMoney(split.fee)} Bidwell fee and ${formatMoney(split.delivery)} delivery).`,
    now
  );
}

function startRefund(db: DatabaseSync, o: Order, now: number, why: string, amountCents = o.total_cents) {
  const p = db
    .prepare(`SELECT reference, provider FROM payments WHERE order_id = ? AND status = 'success' ORDER BY id DESC LIMIT 1`)
    .get(o.id) as { reference: string; provider: string } | undefined;
  db.prepare(`UPDATE orders SET escrow_status = 'refunded' WHERE id = ?`).run(o.id);
  db.prepare(
    `INSERT OR IGNORE INTO refunds (order_id, payment_reference, provider, amount_cents, currency, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(o.id, p?.reference ?? null, p?.provider ?? null, amountCents, currencyOf(db, o), p ? "pending" : "manual", now, now);
  setStatus(
    db,
    o.id,
    "refunded",
    `${why} ${formatMoney(amountCents)} is being refunded to the winner${p ? "" : " (paid offline, so Bidwell refunds it by hand)"}.`,
    now
  );
}

/** After a failed delivery the item is back with the seller: refund the winner what's left. */
export function settleReturnedOrder(db: DatabaseSync, orderId: number, now = Date.now()) {
  const o = requireOrder(db, orderId);
  if (o.status !== "returned" || o.escrow_status !== "held") return;
  const s = failedDeliverySplit(o);
  tx(db, () =>
    startRefund(
      db,
      o,
      now,
      `Delivery failed 3 times. From the ${formatMoney(s.total)} paid, Bidwell keeps the ${formatMoney(s.fee)} fee and ${formatMoney(s.delivery + s.returnFee)} for delivery and return.`,
      s.refund
    )
  );
}

function currencyOf(db: DatabaseSync, o: Order): string {
  const p = db.prepare(`SELECT currency FROM payments WHERE order_id = ? AND status = 'success' LIMIT 1`).get(o.id) as
    | { currency: string }
    | undefined;
  return p?.currency ?? process.env.NEXT_PUBLIC_CURRENCY ?? "USD";
}

/**
 * Releases delivered orders whose 6-hour window passed with no acceptance and no report.
 * Safe to run as often as you like (it runs on page loads and from the cron endpoint).
 */
export function runEscrowTimers(db: DatabaseSync, now = Date.now()): { released: number } {
  const due = db
    .prepare(`SELECT id FROM orders WHERE status = 'delivered' AND escrow_status = 'held' AND release_at <= ?`)
    .all(now) as { id: number }[];
  for (const { id } of due) {
    tx(db, () => {
      const o = getOrder(db, id);
      if (o?.status === "delivered" && o.escrow_status === "held")
        release(db, o, now, "No problem was reported within 6 hours of delivery.");
    });
  }
  // Items handed back to the seller after failed deliveries: refund the winner what's left.
  const returned = db.prepare(`SELECT id FROM orders WHERE status = 'returned' AND escrow_status = 'held'`).all() as { id: number }[];
  for (const { id } of returned) settleReturnedOrder(db, id, now);
  return { released: due.length };
}

/* ---------------------------------- Payouts --------------------------------- */

export function getPayoutAccount(db: DatabaseSync, userId: number): PayoutAccount | undefined {
  return db.prepare(`SELECT * FROM payout_accounts WHERE user_id = ?`).get(userId) as PayoutAccount | undefined;
}

/** Saves where a seller wants to be paid, and queues any payouts that were waiting on it. */
export function savePayoutAccount(
  db: DatabaseSync,
  userId: number,
  input: { method: "bank" | "mobile_money"; bankCode: string; bankName: string; accountNumber: string; accountName: string },
  now = Date.now()
) {
  const num = input.accountNumber.replace(/[\s-]/g, "");
  if (!["bank", "mobile_money"].includes(input.method)) throw new AuctionError("Choose bank account or mobile money.");
  if (!input.bankCode) throw new AuctionError(input.method === "bank" ? "Choose your bank." : "Choose your mobile money network.");
  if (!/^\d{6,20}$/.test(num)) throw new AuctionError("Enter a valid account or phone number (digits only).");
  if (!input.accountName.trim()) throw new AuctionError("Enter the name on the account.");
  tx(db, () => {
    db.prepare(
      `INSERT INTO payout_accounts (user_id, method, bank_code, bank_name, account_number, account_name, recipient_code, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET method = excluded.method, bank_code = excluded.bank_code,
         bank_name = excluded.bank_name, account_number = excluded.account_number,
         account_name = excluded.account_name, recipient_code = NULL, updated_at = excluded.updated_at`
    ).run(userId, input.method, input.bankCode, input.bankName, num, input.accountName.trim(), now);
    db.prepare(
      `UPDATE payouts SET status = 'pending', failure_reason = NULL, updated_at = ? WHERE seller_id = ? AND status IN ('waiting_details', 'failed')`
    ).run(now, userId);
  });
}

export function payoutsForSeller(db: DatabaseSync, userId: number) {
  return db
    .prepare(
      `SELECT p.*, a.title AS auction_title FROM payouts p JOIN orders o ON o.id = p.order_id JOIN auctions a ON a.id = o.auction_id
       WHERE p.seller_id = ? ORDER BY p.id DESC`
    )
    .all(userId) as (Payout & { auction_title: string })[];
}

/** Money the seller has sold for that is still held, keyed by order. */
export function heldForSeller(db: DatabaseSync, userId: number) {
  return db
    .prepare(
      `SELECT o.id, (o.total_cents - o.delivery_fee_cents) AS amount_cents, o.status, o.release_at, a.title AS auction_title FROM orders o JOIN auctions a ON a.id = o.auction_id
       WHERE o.seller_id = ? AND o.escrow_status IN ('held', 'frozen') ORDER BY o.id DESC`
    )
    .all(userId) as { id: number; amount_cents: number; status: OrderStatus; release_at: number | null; auction_title: string }[];
}

export function getPayoutForOrder(db: DatabaseSync, orderId: number): Payout | undefined {
  return db.prepare(`SELECT * FROM payouts WHERE order_id = ?`).get(orderId) as Payout | undefined;
}

export function getRefundForOrder(db: DatabaseSync, orderId: number): Refund | undefined {
  return db.prepare(`SELECT * FROM refunds WHERE order_id = ?`).get(orderId) as Refund | undefined;
}

/**
 * Sends every queued payout through the payout provider. Each payout is claimed (moved to
 * "processing") before the network call, so two runs at once can't pay the same order twice.
 */
export async function processPayouts(db: DatabaseSync, provider: PaymentProvider | undefined, now = Date.now()) {
  if (!provider?.payouts) return { sent: 0, failed: 0 };
  const queued = db.prepare(`SELECT id FROM payouts WHERE status = 'pending' ORDER BY id`).all() as { id: number }[];
  let sent = 0;
  let failed = 0;
  for (const { id } of queued) {
    const claimed = db
      .prepare(`UPDATE payouts SET status = 'processing', provider = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'`)
      .run(provider.id, now, id);
    if (!claimed.changes) continue;
    const p = db.prepare(`SELECT * FROM payouts WHERE id = ?`).get(id) as Payout;
    const fail = (why: string) => {
      db.prepare(`UPDATE payouts SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?`).run(why, Date.now(), id);
      failed++;
    };
    try {
      const acct = getPayoutAccount(db, p.seller_id);
      if (!acct) {
        db.prepare(`UPDATE payouts SET status = 'waiting_details', updated_at = ? WHERE id = ?`).run(Date.now(), id);
        continue;
      }
      let recipient = acct.recipient_code;
      if (!recipient) {
        recipient = await provider.payouts.createRecipient({
          method: acct.method,
          name: acct.account_name,
          accountNumber: acct.account_number,
          bankCode: acct.bank_code,
          currency: p.currency,
        });
        db.prepare(`UPDATE payout_accounts SET recipient_code = ? WHERE user_id = ?`).run(recipient, acct.user_id);
      }
      const r = await provider.payouts.transfer({
        amountCents: p.amount_cents,
        currency: p.currency,
        recipient,
        reference: p.reference,
        reason: `Bidwell sale, order #${p.order_id}`,
      });
      if (r.status === "failed") fail(r.message ?? "The transfer was declined.");
      else {
        applyTransferResult(db, p.reference, r.status, r.providerRef);
        sent++;
      }
    } catch (e) {
      fail((e as Error).message);
    }
  }
  return { sent, failed };
}

/** Records a transfer outcome, from processPayouts or from the provider's webhook. */
export function applyTransferResult(
  db: DatabaseSync,
  reference: string,
  status: "paid" | "processing" | "failed",
  providerRef?: string,
  message?: string,
  now = Date.now()
) {
  const p = db.prepare(`SELECT * FROM payouts WHERE reference = ?`).get(reference) as Payout | undefined;
  if (!p || p.status === "paid") return;
  tx(db, () => {
    db.prepare(
      `UPDATE payouts SET status = ?, provider_ref = COALESCE(?, provider_ref), failure_reason = ?, updated_at = ? WHERE id = ?`
    ).run(status, providerRef ?? null, status === "failed" ? message ?? "Transfer failed" : null, now, p.id);
    if (status === "paid") event(db, p.order_id, "completed", `${formatMoney(p.amount_cents)} paid out to the seller.`, now);
  });
}

/** An admin puts a failed payout back in the queue. */
export function retryPayout(db: DatabaseSync, payoutId: number, now = Date.now()) {
  const r = db
    .prepare(`UPDATE payouts SET status = 'pending', failure_reason = NULL, updated_at = ? WHERE id = ? AND status = 'failed'`)
    .run(now, payoutId);
  if (!r.changes) throw new AuctionError("Only failed payouts can be retried.");
}

/** Sends queued refunds back through the provider that took the payment. */
export async function processRefunds(db: DatabaseSync, providerFor: (id: string) => PaymentProvider | undefined, now = Date.now()) {
  const queued = db.prepare(`SELECT * FROM refunds WHERE status = 'pending' ORDER BY id`).all() as Refund[];
  for (const r of queued) {
    const provider = r.provider ? providerFor(r.provider) : undefined;
    if (!provider || !r.payment_reference) continue;
    const claimed = db.prepare(`UPDATE refunds SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'pending'`).run(now, r.id);
    if (!claimed.changes) continue;
    const res = await provider.refund(r.payment_reference, r.amount_cents);
    applyRefundResult(db, r.payment_reference, res.status, res.providerRef, res.message);
  }
}

export function applyRefundResult(
  db: DatabaseSync,
  paymentReference: string,
  status: "processed" | "processing" | "failed",
  providerRef?: string,
  message?: string,
  now = Date.now()
) {
  const r = db.prepare(`SELECT * FROM refunds WHERE payment_reference = ?`).get(paymentReference) as Refund | undefined;
  if (!r || r.status === "processed") return;
  tx(db, () => {
    db.prepare(
      `UPDATE refunds SET status = ?, provider_ref = COALESCE(?, provider_ref), failure_reason = ?, updated_at = ? WHERE id = ?`
    ).run(status, providerRef ?? null, status === "failed" ? message ?? "Refund failed" : null, now, r.id);
    if (status === "processed") event(db, r.order_id, "refunded", `${formatMoney(r.amount_cents)} refunded to the winner.`, now);
  });
}

export function retryRefund(db: DatabaseSync, refundId: number, now = Date.now()) {
  const r = db.prepare(`UPDATE refunds SET status = 'pending', failure_reason = NULL, updated_at = ? WHERE id = ? AND status = 'failed'`).run(now, refundId);
  if (!r.changes) throw new AuctionError("Only failed refunds can be retried.");
}

export function markRefundDoneManually(db: DatabaseSync, refundId: number, now = Date.now()) {
  const r = db.prepare(`SELECT * FROM refunds WHERE id = ?`).get(refundId) as Refund | undefined;
  if (!r || !["manual", "failed"].includes(r.status)) throw new AuctionError("Only offline or failed refunds can be marked as done by hand.");
  tx(db, () => {
    db.prepare(`UPDATE refunds SET status = 'processed', failure_reason = NULL, updated_at = ? WHERE id = ?`).run(now, r.id);
    event(db, r.order_id, "refunded", `Bidwell refunded ${formatMoney(r.amount_cents)} to the winner by hand.`, now);
  });
}

/* ----------------------------------- Admin ---------------------------------- */

export function isAdminEmail(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

function returnedFees(db: DatabaseSync): number {
  const rows = db.prepare(`SELECT total_cents FROM orders WHERE returned_at IS NOT NULL AND status = 'refunded'`).all() as { total_cents: number }[];
  return rows.reduce((s, r) => s + feeFor(r.total_cents), 0);
}

export function adminOverview(db: DatabaseSync) {
  const sum = (sql: string) => (db.prepare(sql).get() as { n: number | null }).n ?? 0;
  return {
    heldCents: sum(`SELECT SUM(total_cents) AS n FROM orders WHERE escrow_status = 'held'`),
    frozenCents: sum(`SELECT SUM(total_cents) AS n FROM orders WHERE escrow_status = 'frozen'`),
    deliveryCents: sum(`SELECT SUM(delivery_fee_cents + CASE WHEN returned_at IS NOT NULL THEN return_fee_cents ELSE 0 END) AS n FROM orders WHERE status IN ('completed','refunded') AND (escrow_status = 'released' OR returned_at IS NOT NULL)`),
    owedCents: sum(`SELECT SUM(amount_cents) AS n FROM payouts WHERE status IN ('waiting_details','pending','processing','failed')`),
    feesCents: sum(`SELECT SUM(fee_cents) AS n FROM payouts`) + returnedFees(db),
    openDisputes: sum(`SELECT COUNT(*) AS n FROM disputes WHERE status = 'open'`),
  };
}

const ORDER_COLS = `o.id, o.total_cents AS amount_cents, o.status, o.escrow_status, o.release_at, a.title AS auction_title,
  bu.name AS buyer_name, se.name AS seller_name`;
const ORDER_JOIN = `JOIN orders o ON o.id = x.order_id JOIN auctions a ON a.id = o.auction_id
  JOIN users bu ON bu.id = o.buyer_id JOIN users se ON se.id = o.seller_id`;

export function adminDisputes(db: DatabaseSync, which: "open" | "closed") {
  return db
    .prepare(
      `SELECT x.*, ${ORDER_COLS} FROM disputes x ${ORDER_JOIN}
       WHERE x.status ${which === "open" ? "= 'open'" : "<> 'open'"} ORDER BY x.id ${which === "open" ? "ASC" : "DESC"} LIMIT 100`
    )
    .all() as (Dispute & { amount_cents: number; auction_title: string; buyer_name: string; seller_name: string })[];
}

export function adminHeldOrders(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT o.id, o.total_cents AS amount_cents, o.status, o.escrow_status, o.release_at, a.title AS auction_title, bu.name AS buyer_name, se.name AS seller_name
       FROM orders o JOIN auctions a ON a.id = o.auction_id JOIN users bu ON bu.id = o.buyer_id JOIN users se ON se.id = o.seller_id
       WHERE o.escrow_status IN ('held','frozen') ORDER BY COALESCE(o.release_at, 9e15) ASC`
    )
    .all() as { id: number; amount_cents: number; status: OrderStatus; escrow_status: string; release_at: number | null; auction_title: string; buyer_name: string; seller_name: string }[];
}

export function adminAwaitingPayment(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT o.id, o.total_cents AS amount_cents, a.title AS auction_title, bu.name AS buyer_name, bu.email AS buyer_email
       FROM orders o JOIN auctions a ON a.id = o.auction_id JOIN users bu ON bu.id = o.buyer_id
       WHERE o.status = 'awaiting_payment' ORDER BY o.id`
    )
    .all() as { id: number; amount_cents: number; auction_title: string; buyer_name: string; buyer_email: string }[];
}

export function adminPayouts(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT x.*, a.title AS auction_title, u.name AS seller_name FROM payouts x
       JOIN orders o ON o.id = x.order_id JOIN auctions a ON a.id = o.auction_id JOIN users u ON u.id = x.seller_id
       ORDER BY CASE x.status WHEN 'failed' THEN 0 WHEN 'waiting_details' THEN 1 WHEN 'pending' THEN 2 WHEN 'processing' THEN 3 ELSE 4 END, x.id DESC
       LIMIT 200`
    )
    .all() as (Payout & { auction_title: string; seller_name: string })[];
}

export function adminRefunds(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT x.*, a.title AS auction_title, u.name AS buyer_name FROM refunds x
       JOIN orders o ON o.id = x.order_id JOIN auctions a ON a.id = o.auction_id JOIN users u ON u.id = o.buyer_id
       ORDER BY CASE x.status WHEN 'failed' THEN 0 WHEN 'manual' THEN 1 ELSE 2 END, x.id DESC LIMIT 200`
    )
    .all() as (Refund & { auction_title: string; buyer_name: string })[];
}
