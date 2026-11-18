import type { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { tx } from "./db.ts";
import { formatMoney } from "./money.ts";
import { quoteDelivery } from "./delivery.ts";
import { SIZES } from "./places.ts";

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
  size: string;
  pickup_city: string | null;
  pickup_region: string | null;
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
  | "returning"
  | "returned"
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
  delivery_fee_cents: number;
  total_cents: number;
  return_fee_cents: number;
  return_code: string | null;
  returned_at: number | null;
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
  courier_id: number | null;
  courier_name: string | null;
  delivery_code: string | null;
  delivery_code_attempts: number;
  delivery_method: "code" | "signature" | "admin" | null;
  delivery_recipient: string | null;
  delivery_signature: string | null;
  accepted_at: number | null;
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
  /** small | medium | large | xl. Defaults to medium. */
  size?: string;
  /** Where the delivery partner collects the item. Used to price delivery. */
  pickupCity?: string;
  pickupRegion?: string;
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
  const size = input.size ?? "medium";
  if (!SIZES.some((s) => s.value === size)) throw new AuctionError("Choose the item's size.");

  const r = db
    .prepare(
      `INSERT INTO auctions (seller_id, title, description, category, condition, image_path, size, pickup_city, pickup_region,
         starting_bid_cents, min_increment_cents, starts_at, ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sellerId,
      input.title.trim(),
      input.description.trim(),
      input.category,
      input.condition,
      input.imagePath,
      size,
      input.pickupCity?.trim() || null,
      input.pickupRegion?.trim() || null,
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
            // Delivery is priced once the winner gives an address (see setShippingAddress).
            `INSERT OR IGNORE INTO orders (auction_id, buyer_id, seller_id, amount_cents, delivery_fee_cents, total_cents, return_fee_cents, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?)`
          )
          .run(id, a.current_bidder_id, a.seller_id, a.current_bid_cents, a.current_bid_cents, now, now);
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
         se.name AS seller_name, COALESCE(co.company, co.name) AS courier_name
  FROM orders o
  JOIN auctions a ON a.id = o.auction_id
  JOIN users bu ON bu.id = o.buyer_id
  JOIN users se ON se.id = o.seller_id
  LEFT JOIN users co ON co.id = o.courier_id`;

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

/**
 * The winner saves (or corrects, until they pay) their shipping address. This prices delivery
 * from the item's size and the distance from the pickup location. A return after failed
 * deliveries costs the same.
 */
export function setShippingAddress(db: DatabaseSync, orderId: number, userId: number, addr: ShippingAddress, now = Date.now()) {
  const o = requireOrder(db, orderId);
  if (o.buyer_id !== userId) throw new AuctionError("Only the winner can set the shipping address.");
  if (!["awaiting_address", "awaiting_payment"].includes(o.status))
    throw new AuctionError("You've already paid, so the address can't be changed here. Contact Bidwell if it's wrong.");
  for (const k of ["name", "phone", "line1", "city", "region", "country"] as const) {
    if (!addr[k]?.trim()) throw new AuctionError("Fill in every required address field.");
  }
  const a = getAuction(db, o.auction_id)!;
  const { feeCents } = quoteDelivery(db, a.size, { city: a.pickup_city, region: a.pickup_region }, { city: addr.city, region: addr.region });
  tx(db, () => {
    db.prepare(
      `UPDATE orders SET ship_name=?, ship_phone=?, ship_line1=?, ship_line2=?, ship_city=?, ship_region=?,
         ship_postal=?, ship_country=?, delivery_fee_cents=?, return_fee_cents=?, total_cents=amount_cents + ?, updated_at=? WHERE id = ?`
    ).run(
      addr.name.trim(),
      addr.phone.trim(),
      addr.line1.trim(),
      addr.line2?.trim() || null,
      addr.city.trim(),
      addr.region.trim(),
      addr.postal?.trim() || null,
      addr.country.trim(),
      feeCents,
      feeCents,
      feeCents,
      now,
      orderId
    );
    if (o.status === "awaiting_address") {
      setStatus(db, orderId, "awaiting_payment", `Shipping address added. Delivery costs ${formatMoney(feeCents)}. Waiting for payment.`, now);
    } else {
      db.prepare(`INSERT INTO order_events (order_id, status, note, created_at) VALUES (?, ?, ?, ?)`).run(
        orderId,
        o.status,
        `Shipping address updated. Delivery costs ${formatMoney(feeCents)}.`,
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
    setStatus(db, orderId, "paid", `Bidwell confirmed payment of ${formatMoney(o.total_cents)} received${note.trim() ? ` (${note.trim()})` : ""}. Held in escrow.`, now);
  });
}

export type DeliveryPartner = { id: number; name: string; company: string | null; email: string };

export function listDeliveryPartners(db: DatabaseSync): DeliveryPartner[] {
  return db
    .prepare(`SELECT id, name, company, email FROM users WHERE role = 'courier' ORDER BY COALESCE(company, name)`)
    .all() as DeliveryPartner[];
}

/** An admin turns an existing account into a delivery partner account. */
export function addDeliveryPartner(db: DatabaseSync, email: string, company: string) {
  if (!company.trim()) throw new AuctionError("Enter the delivery company's name.");
  const r = db.prepare(`UPDATE users SET role = 'courier', company = ? WHERE email = ?`).run(company.trim(), email.trim().toLowerCase());
  if (!r.changes) throw new AuctionError("No account uses that email. Ask the rider to sign up first.");
}

export function removeDeliveryPartner(db: DatabaseSync, userId: number) {
  const busy = db.prepare(`SELECT 1 FROM orders WHERE courier_id = ? AND status = 'shipped' LIMIT 1`).get(userId);
  if (busy) throw new AuctionError("This partner still has deliveries in progress.");
  db.prepare(`UPDATE users SET role = 'member', company = NULL WHERE id = ?`).run(userId);
}

/**
 * The seller hands the item to a Bidwell delivery partner. A 6-digit delivery code is created;
 * only the winner (and admins) can see it, and the partner needs it, or the winner's signature,
 * to confirm delivery.
 */
export function markShipped(
  db: DatabaseSync,
  orderId: number,
  userId: number,
  courierId: number,
  tracking: string,
  now = Date.now()
) {
  const o = requireOrder(db, orderId);
  if (o.seller_id !== userId) throw new AuctionError("Only the seller can hand the item to a delivery partner.");
  if (o.status !== "paid") throw new AuctionError("Wait for payment before shipping.");
  const partner = db.prepare(`SELECT id, name, company FROM users WHERE id = ? AND role = 'courier'`).get(courierId) as
    | { id: number; name: string; company: string | null }
    | undefined;
  if (!partner) throw new AuctionError("Choose a delivery partner.");
  const carrier = partner.company ?? partner.name;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  tx(db, () => {
    db.prepare(
      `UPDATE orders SET carrier = ?, courier_id = ?, tracking_number = ?, delivery_code = ?, delivery_code_attempts = 0, shipped_at = ? WHERE id = ?`
    ).run(carrier, partner.id, tracking.trim() || null, code, now, orderId);
    setStatus(db, orderId, "shipped", `Handed to ${carrier} for delivery${tracking.trim() ? ` (tracking ${tracking.trim()})` : ""}.`, now);
  });
}

/** How long after delivery is confirmed the buyer can still report a problem before funds go to the seller. */
export const DISPUTE_WINDOW_MS = Number(process.env.DISPUTE_WINDOW_HOURS ?? 6) * 3_600_000;

/** Wrong code entries allowed before the partner must take a signature instead. */
export const MAX_CODE_ATTEMPTS = 5;

export type DeliveryProof =
  | { method: "code"; code: string; recipientName: string }
  | { method: "signature"; signature: string; recipientName: string };

/**
 * The delivery partner confirms they handed the item over, proven by the winner's delivery code
 * or their signature. This starts the 6-hour window.
 */
export function confirmDeliveryByPartner(db: DatabaseSync, orderId: number, courierId: number, proof: DeliveryProof, now = Date.now()) {
  const o = requireOrder(db, orderId);
  if (o.courier_id !== courierId) throw new AuctionError("This delivery isn't assigned to you.");
  if (o.status !== "shipped") throw new AuctionError("This order isn't out for delivery.");
  if (!proof.recipientName.trim()) throw new AuctionError("Enter the name of the person who received it.");
  if (proof.method === "code") {
    if (o.delivery_code_attempts >= MAX_CODE_ATTEMPTS)
      throw new AuctionError("Too many wrong codes. Take the recipient's signature instead.");
    const given = proof.code.replace(/\D/g, "");
    const ok = given.length === 6 && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(o.delivery_code ?? "------"));
    if (!ok) {
      db.prepare(`UPDATE orders SET delivery_code_attempts = delivery_code_attempts + 1 WHERE id = ?`).run(o.id);
      const left = MAX_CODE_ATTEMPTS - o.delivery_code_attempts - 1;
      throw new AuctionError(
        left > 0 ? `That code doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Take the recipient's signature instead."
      );
    }
  } else {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{200,}$/.test(proof.signature) || proof.signature.length > 400_000)
      throw new AuctionError("Ask the recipient to sign in the box.");
  }
  tx(db, () => {
    db.prepare(`UPDATE orders SET delivery_method = ?, delivery_recipient = ?, delivery_signature = ? WHERE id = ?`).run(
      proof.method,
      proof.recipientName.trim(),
      proof.method === "signature" ? proof.signature : null,
      o.id
    );
    confirmDelivery(
      db,
      o,
      now,
      `${o.carrier} delivered it to ${proof.recipientName.trim()}, confirmed by ${proof.method === "code" ? "the winner's delivery code" : "signature"}.`
    );
  });
}

/** Admin override when a partner can't confirm in the app (e.g. phone died). The caller checks admin rights. */
export function adminConfirmDelivery(db: DatabaseSync, orderId: number, note: string, now = Date.now()) {
  const o = requireOrder(db, orderId);
  if (o.status !== "shipped") throw new AuctionError("This order isn't out for delivery.");
  if (!note.trim()) throw new AuctionError("Say how the delivery was confirmed.");
  tx(db, () => {
    db.prepare(`UPDATE orders SET delivery_method = 'admin', delivery_recipient = ? WHERE id = ?`).run(note.trim(), o.id);
    confirmDelivery(db, o, now, `Bidwell confirmed delivery: ${note.trim()}.`);
  });
}

/** Failed attempts allowed before the item goes back to the seller. */
export const MAX_DELIVERY_ATTEMPTS = 3;

export type DeliveryAttempt = {
  id: number;
  order_id: number;
  courier_id: number;
  attempt_no: number;
  note: string;
  photo_path: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  created_at: number;
};

export function deliveryAttempts(db: DatabaseSync, orderId: number): DeliveryAttempt[] {
  return db.prepare(`SELECT * FROM delivery_attempts WHERE order_id = ? ORDER BY attempt_no`).all(orderId) as DeliveryAttempt[];
}

/**
 * The delivery partner records a failed attempt, proven by a photo taken at the address, the
 * phone's location and the server time. After the third, the item goes back to the seller: the
 * seller gets a return code to give the partner when they take it back.
 */
export function recordFailedAttempt(
  db: DatabaseSync,
  orderId: number,
  courierId: number,
  input: { note: string; photoPath: string; lat?: number | null; lng?: number | null; accuracyM?: number | null },
  now = Date.now()
): number {
  const o = requireOrder(db, orderId);
  if (o.courier_id !== courierId) throw new AuctionError("This delivery isn't assigned to you.");
  if (o.status !== "shipped") throw new AuctionError("This order isn't out for delivery.");
  if (!input.photoPath) throw new AuctionError("Take a photo at the address as proof of the visit.");
  if (input.note.trim().length < 5) throw new AuctionError("Say what happened, e.g. nobody home, phone off.");
  const n = deliveryAttempts(db, orderId).length + 1;
  const gps = input.lat != null && input.lng != null && Number.isFinite(input.lat) && Number.isFinite(input.lng);
  tx(db, () => {
    db.prepare(
      `INSERT INTO delivery_attempts (order_id, courier_id, attempt_no, note, photo_path, lat, lng, accuracy_m, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(o.id, courierId, n, input.note.trim().slice(0, 1000), input.photoPath, gps ? input.lat! : null, gps ? input.lng! : null, gps ? input.accuracyM ?? null : null, now);
    const where = gps ? "location recorded" : "no location from the phone";
    if (n < MAX_DELIVERY_ATTEMPTS) {
      setStatus(db, o.id, "shipped", `Delivery attempt ${n} of ${MAX_DELIVERY_ATTEMPTS} failed: ${input.note.trim()} (photo taken, ${where}).`, now);
    } else {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      db.prepare(`UPDATE orders SET return_code = ?, delivery_code_attempts = 0 WHERE id = ?`).run(code, o.id);
      setStatus(
        db,
        o.id,
        "returning",
        `Delivery attempt ${n} of ${MAX_DELIVERY_ATTEMPTS} failed: ${input.note.trim()} (photo taken, ${where}). The item is going back to the seller at the winner's cost.`,
        now
      );
    }
  });
  return n;
}

/**
 * The partner hands the item back to the seller, proven by the seller's return code or
 * signature. The caller (escrow) then refunds the winner what is left after the fee and
 * delivery costs.
 */
export function confirmReturnToSeller(db: DatabaseSync, orderId: number, courierId: number, proof: DeliveryProof, now = Date.now()) {
  const o = requireOrder(db, orderId);
  if (o.courier_id !== courierId) throw new AuctionError("This return isn't assigned to you.");
  if (o.status !== "returning") throw new AuctionError("This order isn't being returned.");
  if (!proof.recipientName.trim()) throw new AuctionError("Enter the name of the person who took it back.");
  if (proof.method === "code") {
    if (o.delivery_code_attempts >= MAX_CODE_ATTEMPTS) throw new AuctionError("Too many wrong codes. Take the seller's signature instead.");
    const given = proof.code.replace(/\D/g, "");
    if (!(given.length === 6 && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(o.return_code ?? "------")))) {
      db.prepare(`UPDATE orders SET delivery_code_attempts = delivery_code_attempts + 1 WHERE id = ?`).run(o.id);
      throw new AuctionError("That return code doesn't match.");
    }
  } else if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{200,}$/.test(proof.signature) || proof.signature.length > 400_000) {
    throw new AuctionError("Ask the seller to sign in the box.");
  }
  tx(db, () => {
    db.prepare(`UPDATE orders SET returned_at = ? WHERE id = ?`).run(now, o.id);
    setStatus(db, o.id, "returned", `${o.carrier} returned the item to ${proof.recipientName.trim()} (${proof.method === "code" ? "seller's return code" : "signature"}).`, now);
  });
}

export function deliveriesForPartner(db: DatabaseSync, courierId: number): Order[] {
  return db
    .prepare(`${ORDER_SELECT} WHERE o.courier_id = ? ORDER BY o.status IN ('shipped','returning') DESC, o.shipped_at DESC LIMIT 200`)
    .all(courierId) as Order[];
}

/** Starts the dispute window once delivery is confirmed. */
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
  ).run(o.id, provider, reference, o.total_cents, currency, now, now);
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
