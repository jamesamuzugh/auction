import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "../src/lib/db.ts";
import { registerUser } from "../src/lib/users.ts";
import {
  applyPaymentResult,
  closeDueAuctions,
  createAuction,
  createPayment,
  getOrder,
  addDeliveryPartner,
  confirmDeliveryByPartner,
  markShipped,
  recordFailedAttempt,
  confirmReturnToSeller,
  orderEvents,
  placeBid,
  setShippingAddress,
} from "../src/lib/auctions.ts";
import {
  acceptItem,
  applyTransferResult,
  getPayoutForOrder,
  getRefundForOrder,
  openDispute,
  processPayouts,
  processRefunds,
  resolveDispute,
  respondToDispute,
  retryPayout,
  runEscrowTimers,
  savePayoutAccount,
  failedDeliverySplit,
  adminOverview,
} from "../src/lib/escrow.ts";
import { demo } from "../src/lib/payments/demo.ts";
import type { PaymentProvider } from "../src/lib/payments/types.ts";

const HOUR = 3_600_000;
process.env.DELIVERY_FEE = "30"; // winner pays bid + 30.00 delivery
process.env.RETURN_FEE = "30";
process.env.PLATFORM_FEE_PERCENT = "5";
const addr = { name: "B", phone: "0240000000", line1: "1 St", city: "Accra", region: "GA", country: "Ghana" };
const momo = { method: "mobile_money" as const, bankCode: "MTN", bankName: "MTN Mobile Money", accountNumber: "0241234567", accountName: "Seller Name" };

/** An order that has been won and paid, so the money is held in escrow. */
function paidOrder() {
  const db = getDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "auction-escrow-")), "t.db"));
  const seller = registerUser(db, "s@example.com", "Seller", "password123");
  const buyer = registerUser(db, "b@example.com", "Buyer", "password123");
  const admin = registerUser(db, "admin@example.com", "Admin", "password123");
  const rider = registerUser(db, "rider@example.com", "Rider", "password123");
  addDeliveryPartner(db, "rider@example.com", "Speedaf");
  const t0 = Date.now() - 48 * HOUR;
  const aid = createAuction(
    db,
    { sellerId: seller.id, title: "Radio", description: "Works", category: "Other", condition: "Used - Good",
      imagePath: null, startingBidCents: 10_000, minIncrementCents: 500, endsAt: t0 + HOUR },
    t0
  );
  placeBid(db, aid, buyer.id, 10_000, t0 + 1);
  closeDueAuctions(db, t0 + HOUR);
  const orderId = getOrder(db, 1)!.id;
  setShippingAddress(db, orderId, buyer.id, addr, t0 + HOUR);
  const p = createPayment(db, orderId, buyer.id, "demo", "GHS", t0 + HOUR);
  applyPaymentResult(db, p.reference, { status: "success", amountCents: 13_000, currency: "GHS" }, "demo", t0 + HOUR);
  /** Seller hands over to the partner, partner delivers with the winner's code. */
  const shipAndDeliver = (t = Date.now()) => {
    markShipped(db, orderId, seller.id, rider.id, "", t);
    confirmDeliveryByPartner(db, orderId, rider.id, { method: "code", code: getOrder(db, orderId)!.delivery_code!, recipientName: "Buyer" }, t);
  };
  return { db, seller, buyer, admin, rider, orderId, ref: p.reference, shipAndDeliver };
}

test("payment is held in escrow, then released 6 hours after delivery with the fee taken off", async () => {
  const { db, seller, orderId, shipAndDeliver } = paidOrder();
  assert.equal(getOrder(db, orderId)!.escrow_status, "held");
  const t = Date.now();
  shipAndDeliver(t);
  assert.equal(getOrder(db, orderId)!.release_at, t + 6 * HOUR);

  assert.deepEqual(runEscrowTimers(db, t + 6 * HOUR - 1), { released: 0 });
  assert.equal(getPayoutForOrder(db, orderId), undefined);
  assert.deepEqual(runEscrowTimers(db, t + 6 * HOUR), { released: 1 });
  const o = getOrder(db, orderId)!;
  assert.equal(o.status, "completed");
  assert.equal(o.escrow_status, "released");
  const p = getPayoutForOrder(db, orderId)!;
  // 100.00 bid + 30.00 delivery = 130.00 paid; 5% of that is 6.50; seller gets 130 - 6.50 - 30 = 93.50
  assert.equal(p.gross_cents, 13_000);
  assert.equal(p.fee_cents, 650);
  assert.equal(p.delivery_fee_cents, 3_000);
  assert.equal(p.amount_cents, 9_350);
  assert.equal(p.status, "waiting_details", "seller has no payout account yet");

  // Running the timer again doesn't pay twice.
  runEscrowTimers(db, t + 7 * HOUR);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM payouts`).get() as { n: number }).n, 1);

  savePayoutAccount(db, seller.id, momo);
  assert.equal(getPayoutForOrder(db, orderId)!.status, "pending");
  process.env.PAYMENTS_DEMO = "1";
  assert.deepEqual(await processPayouts(db, demo), { sent: 1, failed: 0 });
  assert.equal(getPayoutForOrder(db, orderId)!.status, "paid");
  assert.deepEqual(await processPayouts(db, demo), { sent: 0, failed: 0 });
  assert.match(orderEvents(db, orderId).at(-1)!.note!, /paid out to the seller/);
});

test("buyer accepting the item pays the seller at once; without it, release waits 6 hours", () => {
  const { db, buyer, seller, orderId, shipAndDeliver } = paidOrder();
  assert.throws(() => acceptItem(db, orderId, buyer.id), /once it has been delivered/);
  shipAndDeliver();
  assert.throws(() => acceptItem(db, orderId, seller.id), /Only the winner/);
  acceptItem(db, orderId, buyer.id);
  assert.equal(getOrder(db, orderId)!.status, "completed");
  assert.ok(getOrder(db, orderId)!.accepted_at);
  assert.equal(getPayoutForOrder(db, orderId)!.gross_cents, 13_000);
  assert.throws(() => acceptItem(db, orderId, buyer.id), /once it has been delivered/);

  // Shipped but never delivered: nothing is released, however long it waits.
  const b = paidOrder();
  markShipped(b.db, b.orderId, b.seller.id, b.rider.id, "");
  assert.equal(runEscrowTimers(b.db, Date.now() + 60 * 24 * HOUR).released, 0);
});

test("delivery partner needs the right code or a signature, with limited code attempts", () => {
  const { db, seller, buyer, rider, orderId } = paidOrder();
  markShipped(db, orderId, seller.id, rider.id, "");
  const code = getOrder(db, orderId)!.delivery_code!;
  const wrong = code === "000000" ? "111111" : "000000";
  assert.throws(() => confirmDeliveryByPartner(db, orderId, buyer.id, { method: "code", code, recipientName: "B" }), /isn't assigned/);
  assert.throws(() => confirmDeliveryByPartner(db, orderId, rider.id, { method: "code", code, recipientName: " " }), /name/);
  for (let i = 4; i >= 1; i--)
    assert.throws(() => confirmDeliveryByPartner(db, orderId, rider.id, { method: "code", code: wrong, recipientName: "B" }), new RegExp(`${i} tr`));
  assert.throws(() => confirmDeliveryByPartner(db, orderId, rider.id, { method: "code", code: wrong, recipientName: "B" }), /signature instead/);
  assert.throws(() => confirmDeliveryByPartner(db, orderId, rider.id, { method: "code", code, recipientName: "B" }), /signature instead/);
  assert.throws(() => confirmDeliveryByPartner(db, orderId, rider.id, { method: "signature", signature: "data:image/png;base64,xx", recipientName: "B" }), /sign/);
  const sig = "data:image/png;base64," + "A".repeat(400);
  confirmDeliveryByPartner(db, orderId, rider.id, { method: "signature", signature: sig, recipientName: "Kofi" });
  const o = getOrder(db, orderId)!;
  assert.equal(o.status, "delivered");
  assert.equal(o.delivery_method, "signature");
  assert.equal(o.delivery_recipient, "Kofi");
});

test("a dispute inside the window freezes the money; after the window it's refused", () => {
  const { db, seller, buyer, orderId, shipAndDeliver } = paidOrder();
  const t = Date.now();
  shipAndDeliver(t);
  assert.throws(() => openDispute(db, orderId, seller.id, "Other", "Seller trying", t), /Only the winner/);
  assert.throws(() => openDispute(db, orderId, buyer.id, "Item arrived damaged", "short", t), /sentence/);
  openDispute(db, orderId, buyer.id, "Item arrived damaged", "The screen is cracked in two places.", t + HOUR);
  assert.equal(getOrder(db, orderId)!.status, "disputed");
  assert.equal(getOrder(db, orderId)!.escrow_status, "frozen");
  // Frozen money isn't released when the window passes.
  assert.equal(runEscrowTimers(db, t + 10 * HOUR).released, 0);

  const late = paidOrder();
  late.shipAndDeliver(t);
  assert.throws(
    () => openDispute(late.db, late.orderId, late.buyer.id, "Other", "Changed my mind about it.", t + 6 * HOUR),
    /time to report a problem has passed/
  );
});

test("admin refund sends the money back through the provider", async () => {
  const { db, seller, buyer, admin, orderId, ref } = paidOrder();
  const id = openDispute(db, orderId, buyer.id, "Item not received", "Nothing arrived after two weeks.");
  respondToDispute(db, id, seller.id, "I sent it, here is the receipt.");
  assert.throws(() => respondToDispute(db, id, buyer.id, "x"), /Only the seller/);
  assert.throws(() => resolveDispute(db, id, admin.id, "refund", " "), /note/);
  resolveDispute(db, id, admin.id, "refund", "Courier confirmed it was lost.");
  assert.equal(getOrder(db, orderId)!.status, "refunded");
  assert.equal(getRefundForOrder(db, orderId)!.status, "pending");
  assert.throws(() => resolveDispute(db, id, admin.id, "release", "again"), /already been resolved/);

  const calls: string[] = [];
  const fake = { ...demo, refund: async (r: string, amt: number) => (calls.push(`${r}:${amt}`), { status: "processed" as const }) } as PaymentProvider;
  await processRefunds(db, () => fake);
  assert.deepEqual(calls, [`${ref}:13000`], "a dispute refund returns everything paid");
  assert.equal(getRefundForOrder(db, orderId)!.status, "processed");
  assert.equal(getPayoutForOrder(db, orderId), undefined, "seller is not paid");
});

test("admin can release to the seller or let the order carry on", () => {
  const a = paidOrder();
  const d1 = openDispute(a.db, a.orderId, a.buyer.id, "Item not received", "It has not shipped yet at all.");
  resolveDispute(a.db, d1, a.admin.id, "resume", "Seller is shipping today.");
  assert.equal(getOrder(a.db, a.orderId)!.status, "paid");
  assert.equal(getOrder(a.db, a.orderId)!.escrow_status, "held");

  const b = paidOrder();
  const d2 = openDispute(b.db, b.orderId, b.buyer.id, "Item not as described", "Colour is slightly different.");
  resolveDispute(b.db, d2, b.admin.id, "release", "Matches the listing photos.");
  assert.equal(getOrder(b.db, b.orderId)!.status, "completed");
  assert.equal(getPayoutForOrder(b.db, b.orderId)!.amount_cents, 9_350);
});

test("failed transfers are recorded and can be retried; webhooks settle processing ones", async () => {
  const { db, seller, orderId, shipAndDeliver } = paidOrder();
  shipAndDeliver();
  runEscrowTimers(db, Date.now() + 7 * HOUR);
  savePayoutAccount(db, seller.id, momo);
  const failing = { ...demo, payouts: { ...demo.payouts!, transfer: async () => ({ status: "failed" as const, message: "Insufficient balance" }) } } as PaymentProvider;
  assert.deepEqual(await processPayouts(db, failing), { sent: 0, failed: 1 });
  assert.equal(getPayoutForOrder(db, orderId)!.failure_reason, "Insufficient balance");
  retryPayout(db, getPayoutForOrder(db, orderId)!.id);
  const slow = { ...demo, payouts: { ...demo.payouts!, transfer: async () => ({ status: "processing" as const, providerRef: "TRF_1" }) } } as PaymentProvider;
  await processPayouts(db, slow);
  const p = getPayoutForOrder(db, orderId)!;
  assert.equal(p.status, "processing");
  applyTransferResult(db, p.reference, "paid");
  assert.equal(getPayoutForOrder(db, orderId)!.status, "paid");
  assert.equal(adminOverview(db).owedCents, 0);
});

test("payout account needs valid details", () => {
  const { db, seller } = paidOrder();
  assert.throws(() => savePayoutAccount(db, seller.id, { ...momo, accountNumber: "abc" }), /valid account/);
  assert.throws(() => savePayoutAccount(db, seller.id, { ...momo, bankCode: "" }), /network/);
});

test("three proven failed attempts send the item back and refund the rest", async () => {
  const { db, seller, buyer, rider, orderId, ref } = paidOrder();
  markShipped(db, orderId, seller.id, rider.id, "");
  const photo = "/proofs/x.jpg";
  assert.throws(() => recordFailedAttempt(db, orderId, buyer.id, { note: "Nobody home", photoPath: photo }), /isn't assigned/);
  assert.throws(() => recordFailedAttempt(db, orderId, rider.id, { note: "Nobody home", photoPath: "" }), /photo/);
  assert.equal(recordFailedAttempt(db, orderId, rider.id, { note: "Nobody home", photoPath: photo, lat: 5.6, lng: -0.18, accuracyM: 12 }), 1);
  assert.equal(recordFailedAttempt(db, orderId, rider.id, { note: "Phone switched off", photoPath: photo }), 2);
  assert.equal(getOrder(db, orderId)!.status, "shipped");
  assert.equal(recordFailedAttempt(db, orderId, rider.id, { note: "Gate locked again", photoPath: photo }), 3);
  const o = getOrder(db, orderId)!;
  assert.equal(o.status, "returning");
  assert.match(o.return_code!, /^\d{6}$/);
  assert.throws(() => recordFailedAttempt(db, orderId, rider.id, { note: "Fourth try", photoPath: photo }), /isn't out for delivery/);
  // The buyer's delivery code no longer works for a return; the seller's return code does.
  assert.throws(
    () => confirmReturnToSeller(db, orderId, rider.id, { method: "code", code: o.delivery_code === o.return_code ? "000000" : o.delivery_code!, recipientName: "Ama" }),
    /doesn't match/
  );
  confirmReturnToSeller(db, orderId, rider.id, { method: "code", code: o.return_code!, recipientName: "Ama" });
  assert.equal(getOrder(db, orderId)!.status, "returned");
  runEscrowTimers(db);
  // 130.00 paid - 6.50 fee - 30.00 delivery - 30.00 return = 63.50 back to the winner
  assert.deepEqual(failedDeliverySplit(getOrder(db, orderId)!), { total: 13_000, fee: 650, delivery: 3_000, returnFee: 3_000, refund: 6_350 });
  assert.equal(getOrder(db, orderId)!.status, "refunded");
  assert.equal(getRefundForOrder(db, orderId)!.amount_cents, 6_350);
  assert.equal(getPayoutForOrder(db, orderId), undefined, "seller has the item back, so no payout");
  const calls: string[] = [];
  const fake = { ...demo, refund: async (r: string, amt: number) => (calls.push(`${r}:${amt}`), { status: "processed" as const }) } as PaymentProvider;
  await processRefunds(db, () => fake);
  assert.deepEqual(calls, [`${ref}:6350`]);
});
