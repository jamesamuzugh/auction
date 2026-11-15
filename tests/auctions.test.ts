import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../src/lib/db.ts";
import { registerUser } from "../src/lib/users.ts";
import {
  createAuction,
  placeBid,
  closeDueAuctions,
  getAuction,
  getOrderForAuction,
  setShippingAddress,
  markPaidOffline,
  markShipped,
  markDelivered,
  minimumNextBid,
  parseMoney,
  orderEvents,
} from "../src/lib/auctions.ts";

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Each test gets its own database file.
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auction-test-"));
  return getDb(path.join(dir, "t.db"));
}

const HOUR = 3_600_000;

function world() {
  const db = freshDb();
  const seller = registerUser(db, "seller@example.com", "Sam Seller", "password123");
  const alice = registerUser(db, "alice@example.com", "Alice", "password123");
  const bob = registerUser(db, "bob@example.com", "Bob", "password123");
  const t0 = Date.now();
  const id = createAuction(
    db,
    {
      sellerId: seller.id,
      title: "Used road bike",
      description: "Good shape",
      category: "Sports & Outdoors",
      condition: "Used - Good",
      imagePath: null,
      startingBidCents: 10_000,
      minIncrementCents: 500,
      endsAt: t0 + HOUR,
    },
    t0
  );
  return { db, seller, alice, bob, id, t0 };
}

test("parseMoney", () => {
  assert.equal(parseMoney("12"), 1200);
  assert.equal(parseMoney("12.5"), 1250);
  assert.equal(parseMoney("1,200.99"), 120099);
  assert.equal(parseMoney("$40"), 4000);
  assert.ok(Number.isNaN(parseMoney("abc")));
  assert.ok(Number.isNaN(parseMoney("1.234")));
});

test("first bid must meet the starting bid, later bids the increment", () => {
  const { db, alice, bob, id, t0 } = world();
  assert.throws(() => placeBid(db, id, alice.id, 9_999, t0 + 1), /at least/);
  placeBid(db, id, alice.id, 10_000, t0 + 1);
  assert.equal(minimumNextBid(getAuction(db, id)!), 10_500);
  assert.throws(() => placeBid(db, id, bob.id, 10_499, t0 + 2), /at least/);
  const a = placeBid(db, id, bob.id, 10_500, t0 + 3);
  assert.equal(a.current_bid_cents, 10_500);
  assert.equal(a.current_bidder_id, bob.id);
  assert.equal(a.bid_count, 2);
});

test("seller can't bid, leader can't outbid themselves, closed auctions reject bids", () => {
  const { db, seller, alice, id, t0 } = world();
  assert.throws(() => placeBid(db, id, seller.id, 20_000, t0 + 1), /own listing/);
  placeBid(db, id, alice.id, 10_000, t0 + 1);
  assert.throws(() => placeBid(db, id, alice.id, 20_000, t0 + 2), /already the highest/);
  assert.throws(() => placeBid(db, id, alice.id, 20_000, t0 + HOUR + 1), /closed/);
});

test("closing picks the highest bidder and the order runs through to delivery", () => {
  const { db, seller, alice, bob, id, t0 } = world();
  placeBid(db, id, alice.id, 10_000, t0 + 1);
  placeBid(db, id, bob.id, 12_000, t0 + 2);
  assert.equal(closeDueAuctions(db, t0 + HOUR - 1), 0);
  assert.equal(closeDueAuctions(db, t0 + HOUR), 1);
  const a = getAuction(db, id)!;
  assert.equal(a.status, "ended");
  assert.equal(a.winner_id, bob.id);

  const o = getOrderForAuction(db, id)!;
  assert.equal(o.buyer_id, bob.id);
  assert.equal(o.amount_cents, 12_000);
  assert.equal(o.status, "awaiting_address");

  assert.throws(() => markPaidOffline(db, o.id, ""), /isn't waiting for payment/);
  assert.throws(
    () => setShippingAddress(db, o.id, alice.id, { name: "x", phone: "1", line1: "a", city: "c", region: "r", country: "k" }),
    /Only the winner/
  );
  setShippingAddress(db, o.id, bob.id, {
    name: "Bob",
    phone: "0200000000",
    line1: "1 Main St",
    city: "Accra",
    region: "Greater Accra",
    country: "Ghana",
  });
  assert.equal(getOrderForAuction(db, id)!.status, "awaiting_payment");
  markPaidOffline(db, o.id, "bank transfer");
  assert.equal(getOrderForAuction(db, id)!.escrow_status, "held");
  assert.throws(() => markDelivered(db, o.id, bob.id), /hasn't shipped/);
  markShipped(db, o.id, seller.id, "DHL", "TRACK123");
  assert.throws(
    () => setShippingAddress(db, o.id, bob.id, { name: "Bob", phone: "1", line1: "a", city: "c", region: "r", country: "k" }),
    /already shipped/
  );
  markDelivered(db, o.id, bob.id);
  const done = getOrderForAuction(db, id)!;
  assert.equal(done.status, "delivered");
  assert.ok(done.release_at! > Date.now());
  assert.equal(done.tracking_number, "TRACK123");
  assert.deepEqual(
    orderEvents(db, o.id).map((e) => e.status),
    ["awaiting_address", "awaiting_payment", "paid", "shipped", "delivered"]
  );
});

test("an auction with no bids closes with no winner and no order", () => {
  const { db, id, t0 } = world();
  closeDueAuctions(db, t0 + HOUR);
  assert.equal(getAuction(db, id)!.winner_id, null);
  assert.equal(getOrderForAuction(db, id), undefined);
});
