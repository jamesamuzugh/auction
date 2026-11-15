import type { DatabaseSync } from "node:sqlite";
import { tx } from "./db.ts";
import { formatMoney } from "./money.ts";

export { formatMoney, parseMoney, CURRENCY } from "./money.ts";

export type Auction = {
  id: number;
  seller_id: number;
  seller_name: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  image_path: string | null;
  starting_bid_cents: number;
  min_increment_cents: number;
  current_bid_cents: number | null;
  current_bidder_id: number | null;
  current_bidder_name: string | null;
  bid_count: number;
  starts_at: number;
  ends_at: number;
  status: "active" | "ended" | "cancelled";
  winner_id: number | null;
  created_at: number;
};

export type Bid = {
  id: number;
  auction_id: number;
  user_id: number;
  bidder_name: string;
  amount_cents: number;
  created_at: number;
};

export type OrderStatus =
  | "awaiting_address"
  | "awaiting_payment"
  | "paid"
  | "shipped"
  | "delivered"
  | "disputed"
  | "completed"
  | "refunded"
  | "cancelled";

export type Order = {
  id: number;
  auction_id: number;
  auction_title: string;
  image_path: string | null;
  buyer_id: number;
  buyer_name: string;
  buyer_email: string;
  seller_id: number;
  seller_name: string;
  amount_cents: number;
  status: OrderStatus;
  ship_name: string | null;
  ship_phone: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_city: string | null;
  ship_region: string | null;
  ship_postal: string | null;
  ship_country: string | null;
  carrier: string | null;
  tracking_number: string | null;
  escrow_status: "none" | "held" | "frozen" | "released" | "refunded";
  shipped_at: number | null;
  delivered_at: number | null;
  release_at: number | null;
  created_at: number;
  updated_at: number;
};

export class AuctionError extends Error {}

export const CATEGORIES = [
  "Electronics",
  "Phones & Tablets",
  "Computers",
  "Furniture",
  "Home & Kitchen",
  "Fashion",
  "Vehicles & Parts",
  "Books",
  "Sports & Outdoors",
  "Toys & Games",
  "Collectibles",
  "Other",
];

export const CONDITIONS = ["Used - Like new", "Used - Good", "Used - Fair", "For parts / not working", "New"];

const AUCTION_SELECT = `
  SELECT a.*, s.name AS seller_name, b.name AS current_bidder_name
  FROM auctions a
  JOIN users s ON s.id = a.seller_id
  LEFT JOIN users b ON b.id = a.current_bidder_id`;

export { minimumNextBid } from "./money.ts";
import { minimumNextBid } from "./money.ts";

export type NewAuction = {
  sellerId: number;
  title: string;
  description: string;
  category: string;
  condition: string;
  imagePath: string | null;
  startingBidCents: number;
  minIncrementCents: number;
  endsAt: number;
};

export function createAuction(db: DatabaseSync, input: NewAuction, now = Date.now()): number {
  if (!input.title.trim()) throw new AuctionError("Give the item a title.");
  if (!input.description.trim()) throw new AuctionError("Add a description.");
  if (!Number.isInteger(input.startingBidCents) || input.startingBidCents <= 0)
    throw new AuctionError("Starting bid must be more than zero.");
  if (!Number.isInteger(input.minIncrementCents) || input.minIncrementCents <= 0)
    throw new AuctionError("Minimum increment must be more than zero.");
  if (input.endsAt <= now + 60_000) throw new AuctionError("The auction must stay open for at least a minute.");
  if (input.endsAt > now + 90 * 86_400_000) throw new AuctionError("Auctions can run for at most 90 days.");

  const r = db
    .prepare(
      `INSERT INTO auctions (seller_id, title, description, category, condition, image_path,
         starting_bid_cents, min_increment_cents, starts_at, ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sellerId,
      input.title.trim(),
      input.description.trim(),
      input.category,
      input.condition,
      input.imagePath,
      input.startingBidCents,
      input.minIncrementCents,
      now,
      input.endsAt,
      now
    );
  return Number(r.lastInsertRowid);
}

/**
 * Closes every active auction whose end time has passed. The highest bidder wins and an order
 * is opened for them. Safe to call often: it only touches auctions that are due.
 */
export function closeDueAuctions(db: DatabaseSync, now = Date.now()): number {
  const due = db
    .prepare(`SELECT id FROM auctions WHERE status = 'active' AND ends_at <= ?`)
    .all(now) as { id: number }[];
  for (const { id } of due) {
    tx(db, () => {
      const a = db.prepare(`SELECT * FROM auctions WHERE id = ? AND status = 'active'`).get(id) as
        | Auction
        | undefined;
      if (!a) return;
      db.prepare(`UPDATE auctions SET status = 'ended', winner_id = ? WHERE id = ?`).run(a.current_bidder_id, id);
      if (a.current_bidder_id != null && a.current_bid_cents != null) {
        const o = db
          .prepare(
            `INSERT OR IGNORE INTO orders (auction_id, buyer_id, seller_id, amount_cents, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(id, a.current_bidder_id, a.seller_id, a.current_bid_cents, now, now);
        if (o.changes) {
          db.prepare(`INSERT INTO order_events (order_id, status, note, created_at) VALUES (?, ?, ?, ?)`).run(
            Number(o.lastInsertRowid),
            "awaiting_address",
            "Auction won. Waiting for the winner's shipping address.",
            now
          );
        }
      }
    });
  }
  return due.length;
}

export function placeBid(
  db: DatabaseSync,
  auctionId: number,
  userId: number,
  amountCents: number,
  now = Date.now()
): Auction {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new AuctionError("Enter a valid bid amount.");
  closeDueAuctions(db, now);
  tx(db, () => {
    const a = db.prepare(`SELECT * FROM auctions WHERE id = ?`).get(auctionId) as Auction | undefined;
    if (!a) throw new AuctionError("That auction doesn't exist.");
    if (a.status !== "active" || a.ends_at <= now) throw new AuctionError("This auction has closed.");
    if (a.seller_id === userId) throw new AuctionError("You can't bid on your own listing.");
    if (a.current_bidder_id === userId) throw new AuctionError("You're already the highest bidder.");
    const min = minimumNextBid(a);
    if (amountCents < min) throw new AuctionError(`Your bid must be at least ${formatMoney(min)}.`);
    db.prepare(`INSERT INTO bids (auction_id, user_id, amount_cents, created_at) VALUES (?, ?, ?, ?)`).run(
      auctionId,
      userId,
      amountCents,
      now
    );
    db.prepare(
      `UPDATE auctions SET current_bid_cents = ?, current_bidder_id = ?, bid_count = bid_count + 1 WHERE id = ?`
    ).run(amountCents, userId, auctionId);
  });
  return getAuction(db, auctionId)!;
}

export function getAuction(db: DatabaseSync, id: number): Auction | undefined {
  return db.prepare(`${AUCTION_SELECT} WHERE a.id = ?`).get(id) as Auction | undefined;
}

export function listAuctions(
  db: DatabaseSync,
  opts: { status?: "active" | "ended"; q?: string; category?: string; sort?: "ending" | "newest" | "price" } = {}
): Auction[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  where.push(`a.status = ?`);
  args.push(opts.status ?? "active");
  if (opts.q) {
    where.push(`(a.title LIKE ? OR a.description LIKE ?)`);
    args.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.category) {
    where.push(`a.category = ?`);
    args.push(opts.category);
  }
  const order =
    opts.sort === "newest"
      ? "a.created_at DESC"
      : opts.sort === "price"
        ? "COALESCE(a.current_bid_cents, a.starting_bid_cents) ASC"
        : opts.status === "ended"
          ? "a.ends_at DESC"
          : "a.ends_at ASC";
  return db
    .prepare(`${AUCTION_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 200`)
    .all(...args) as Auction[];
}

export function listBids(db: DatabaseSync, auctionId: number, limit = 50): Bid[] {
  return db
    .prepare(
      `SELECT b.*, u.name AS bidder_name FROM bids b JOIN users u ON u.id = b.user_id
       WHERE b.auction_id = ? ORDER BY b.amount_cents DESC, b.id DESC LIMIT ?`
    )
    .all(auctionId, limit) as Bid[];
}

export function auctionsBidOnBy(db: DatabaseSync, userId: number): (Auction & { my_max_cents: number })[] {
  return db
    .prepare(
      `${AUCTION_SELECT.replace("SELECT a.*", "SELECT a.*, m.my_max_cents")}
       JOIN (SELECT auction_id, MAX(amount_cents) AS my_max_cents FROM bids WHERE user_id = ? GROUP BY auction_id) m
         ON m.auction_id = a.id
       ORDER BY a.status = 'active' DESC, a.ends_at ASC`
    )
    .all(userId) as (Auction & { my_max_cents: number })[];
}

export function auctionsSoldBy(db: DatabaseSync, userId: number): (Auction & { order_id: number | null; order_status: OrderStatus | null })[] {
  return db
    .prepare(
      `${AUCTION_SELECT.replace("SELECT a.*", "SELECT a.*, o.id AS order_id, o.status AS order_status")}
       LEFT JOIN orders o ON o.auction_id = a.id
       WHERE a.seller_id = ? ORDER BY a.status = 'active' DESC, a.ends_at DESC`
    )
    .all(userId) as (Auction & { order_id: number | null; order_status: OrderStatus | null })[];
}

export function cancelAuction(db: DatabaseSync, auctionId: number, userId: number) {
  const a = getAuction(db, auctionId);
  if (!a || a.seller_id !== userId) throw new AuctionError("Only the seller can cancel this listing.");
  if (a.status !== "active") throw new AuctionError("This auction is already closed.");
  if (a.bid_count > 0) throw new AuctionError("Listings with bids can't be cancelled.");
  db.prepare(`UPDATE auctions SET status = 'cancelled' WHERE id = ?`).run(auctionId);
}

/* ---------------------------------- Orders ---------------------------------- */

const ORDER_SELECT = `
  SELECT o.*, a.title AS auction_title, a.image_path, bu.name AS buyer_name, bu.email AS buyer_email,
         se.name AS seller_name
  FROM orders o
  JOIN auctions a ON a.id = o.auction_id
  JOIN users bu ON bu.id = o.buyer_id
  JOIN users se ON se.id = o.seller_id`;

export function getOrder(db: DatabaseSync, id: number): Order | undefined {
  return db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id) as Order | undefined;
}

export function getOrderForAuction(db: DatabaseSync, auctionId: number): Order | undefined {
  return db.prepare(`${ORDER_SELECT} WHERE o.auction_id = ?`).get(auctionId) as Order | undefined;
}

export function ordersForBuyer(db: DatabaseSync, userId: number): Order[] {
  return db.prepare(`${ORDER_SELECT} WHERE o.buyer_id = ? ORDER BY o.created_at DESC`).all(userId) as Order[];
}

export function orderEvents(db: DatabaseSync, orderId: number) {
  return db
    .prepare(`SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id ASC`)
    .all(orderId) as { status: OrderStatus; note: string | null; created_at: number }[];
}

export type ShippingAddress = {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postal?: string;
  country: string;
};

export function setStatus(db: DatabaseSync, orderId: number, status: OrderStatus, note: string, now: number) {
  db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, orderId);
  db.prepare(`INSERT INTO order_events (order_id, status, note, created_at) VALUES (?, ?, ?, ?)`).run(
    orderId,
    status,
    note,
    now
  );
}

export function requireOrder(db: DatabaseSync, orderId: number): Order {
  const o = getOrder(db, orderId);
  if (!o) throw new AuctionError("Order not found.");
  return o;
}

/** The winner saves (or corrects, until it ships) their shipping address. */
export function setShippingAddress(db: DatabaseSync, orderId: number, userId: number, addr: ShippingAddress, now = Date.now()) {
  const o = requireOrder(db, orderId);
  if (o.buyer_id !== userId) throw new AuctionError("Only the winner can set the shipping address.");
  if (!["awaiting_address", "awaiting_payment", "paid"].includes(o.status))
    throw new AuctionError("The item has already shipped, so the address can't be changed.");
  for (const k of ["name", "phone", "line1", "city", "region", "country"] as const) {
    if (!addr[k]?.trim()) throw new AuctionError("Fill in every required address field.");
  }
  tx(db, () => {
    db.prepare(
      `UPDATE orders SET ship_name=?, ship_phone=?, ship_line1=?, ship_line2=?, ship_city=?, ship_region=?,
         ship_postal=?, ship_country=?, updated_at=? WHERE id = ?`
    ).run(
      addr.name.trim(),
      addr.phone.trim(),
      addr.line1.trim(),
      addr.line2?.trim() || null,
      addr.city.trim(),
      addr.region.trim(),
      addr.postal?.trim() || null,
      addr.country.trim(),
      now,
      orderId
    );
    if (o.status === "awaiting_address") {
      setStatus(db, orderId, "awaiting_payment", "Shipping address added. Waiting for payment.", now);
    } else {
      db.prepare(`INSERT INTO order_events (order_id, status, note, created_at) VALUES (?, ?, ?, ?)`).run(
        orderId,
        o.status,
        "Shipping address updated.",
        now
      );
    }
  });
}

/**
 * A Bidwell admin confirms that the winner paid into Bidwell's own account outside the site
 * (bank transfer, cash). The money is then held in escrow exactly like an online payment.
 * The caller must check the user is an admin.
 */
export function markPaidOffline(db: DatabaseSync, orderId: number, note: string, now = Date.now()) {
  const o = requireOrder(db, orderId);
  if (o.status !== "awaiting_payment") throw new AuctionError("This order isn't waiting for payment.");
  tx(db, () => {
    db.prepare(`UPDATE orders SET escrow_status = 'held' WHERE id = ?`).run(orderId);
    setStatus(db, orderId, "paid", `Bidwell confirmed payment of ${formatMoney(o.amount_cents)} received${note.trim() ? ` (${note.trim()})` : ""}. Held in escrow.`, now);
  });
}

export function markShipped(
  db: DatabaseSync,
  orderId: number,
  userId: number,
  carrier: string,
  tracking: string,
  now = Date.now()
) {
  const o = requireOrder(db, orderId);
  if (o.seller_id !== userId) throw new AuctionError("Only the seller can mark the item shipped.");
  if (o.status !== "paid") throw new AuctionError("Confirm payment before shipping.");
  if (!carrier.trim()) throw new AuctionError("Enter the shipping carrier or courier.");
  tx(db, () => {
    db.prepare(`UPDATE orders SET carrier = ?, tracking_number = ?, shipped_at = ? WHERE id = ?`).run(
      carrier.trim(),
      tracking.trim() || null,
      now,
      orderId
    );
    setStatus(
      db,
      orderId,
      "shipped",
      `Shipped with ${carrier.trim()}${tracking.trim() ? ` (tracking ${tracking.trim()})` : ""}.`,
      now
    );
  });
}

/** How long after delivery is confirmed the buyer can still report a problem before funds go to the seller. */
export const DISPUTE_WINDOW_MS = Number(process.env.DISPUTE_WINDOW_HOURS ?? 6) * 3_600_000;

export function markDelivered(db: DatabaseSync, orderId: number, userId: number, now = Date.now()) {
  const o = requireOrder(db, orderId);
  if (o.buyer_id !== userId) throw new AuctionError("Only the winner can confirm delivery.");
  if (o.status !== "shipped") throw new AuctionError("The item hasn't shipped yet.");
  tx(db, () => confirmDelivery(db, o, now, "Winner confirmed the item arrived."));
}

/** Starts the dispute window. Used by the buyer's confirmation and by auto-confirmation. */
export function confirmDelivery(db: DatabaseSync, o: Order, now: number, why: string) {
  const releaseAt = now + DISPUTE_WINDOW_MS;
  db.prepare(`UPDATE orders SET delivered_at = ?, release_at = ? WHERE id = ?`).run(now, releaseAt, o.id);
  const hours = Math.round(DISPUTE_WINDOW_MS / 360_000) / 10;
  setStatus(db, o.id, "delivered", `${why} Funds release to the seller in ${hours} hours unless a problem is reported.`, now);
}

/* -------------------------------- Payments -------------------------------- */

export type Payment = {
  id: number;
  order_id: number;
  provider: string;
  reference: string;
  amount_cents: number;
  currency: string;
  status: "pending" | "success" | "failed";
  provider_ref: string | null;
  created_at: number;
  updated_at: number;
};

/** Opens a pending payment for the winner. The caller then hands its reference to the provider. */
export function createPayment(
  db: DatabaseSync,
  orderId: number,
  userId: number,
  provider: string,
  currency: string,
  now = Date.now()
): Payment & { buyer_email: string } {
  const o = requireOrder(db, orderId);
  if (o.buyer_id !== userId) throw new AuctionError("Only the winner can pay for this order.");
  if (o.status === "awaiting_address") throw new AuctionError("Add your shipping address before paying.");
  if (o.status !== "awaiting_payment") throw new AuctionError("This order has already been paid.");
  const reference = `ord${o.id}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO payments (order_id, provider, reference, amount_cents, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(o.id, provider, reference, o.amount_cents, currency, now, now);
  return { ...getPayment(db, reference)!, buyer_email: o.buyer_email };
}

export function getPayment(db: DatabaseSync, reference: string): Payment | undefined {
  return db.prepare(`SELECT * FROM payments WHERE reference = ?`).get(reference) as Payment | undefined;
}

/**
 * Records what the provider said about a payment. On a verified success for the full amount the
 * order moves to "paid". Safe to call more than once for the same reference (callback + webhook).
 */
export function applyPaymentResult(
  db: DatabaseSync,
  reference: string,
  result: { status: "success" | "failed" | "pending"; amountCents: number; currency: string; providerRef?: string },
  providerLabel: string,
  now = Date.now()
): { orderId: number; outcome: "paid" | "already_paid" | "failed" | "pending" | "mismatch" } {
  return tx(db, () => {
    const p = getPayment(db, reference);
    if (!p) throw new AuctionError("Unknown payment reference.");
    if (p.status === "success") return { orderId: p.order_id, outcome: "already_paid" as const };
    if (result.status === "pending") return { orderId: p.order_id, outcome: "pending" as const };
    if (result.status === "failed") {
      db.prepare(`UPDATE payments SET status = 'failed', updated_at = ? WHERE id = ?`).run(now, p.id);
      return { orderId: p.order_id, outcome: "failed" as const };
    }
    if (result.amountCents !== p.amount_cents || result.currency.toUpperCase() !== p.currency.toUpperCase()) {
      db.prepare(`UPDATE payments SET status = 'failed', updated_at = ? WHERE id = ?`).run(now, p.id);
      return { orderId: p.order_id, outcome: "mismatch" as const };
    }
    db.prepare(`UPDATE payments SET status = 'success', provider_ref = ?, updated_at = ? WHERE id = ?`).run(
      result.providerRef ?? null,
      now,
      p.id
    );
    const o = getOrder(db, p.order_id)!;
    if (o.status === "awaiting_payment") {
      db.prepare(`UPDATE orders SET escrow_status = 'held' WHERE id = ?`).run(o.id);
      setStatus(
        db,
        o.id,
        "paid",
        `Paid ${formatMoney(p.amount_cents)} via ${providerLabel} (ref ${p.reference}). Bidwell is holding it in escrow.`,
        now
      );
    }
    return { orderId: p.order_id, outcome: "paid" as const };
  });
}
