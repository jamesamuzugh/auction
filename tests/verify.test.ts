import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "../src/lib/db.ts";
import { registerUser } from "../src/lib/users.ts";
import { closeDueAuctions, createAuction, getOrderForAuction, placeBid, setShippingAddress } from "../src/lib/auctions.ts";
import { distanceBand, quoteDelivery, setDeliveryRate } from "../src/lib/delivery.ts";
import { normalizePhone } from "../src/lib/sms.ts";
import {
  assertVerified,
  confirmPhoneCode,
  reviewIdCheck,
  startPhoneCheck,
  submitIdCheck,
  verificationFor,
} from "../src/lib/verify.ts";

const fresh = () => getDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "auction-verify-")), "t.db"));
const HOUR = 3_600_000;

test("delivery is priced by size and distance band, and a return costs the same", () => {
  const db = fresh();
  assert.equal(distanceBand({ city: "Accra", region: "Greater Accra" }, { city: " accra ", region: "Greater Accra" }), "same_city");
  assert.equal(distanceBand({ city: "Accra", region: "Greater Accra" }, { city: "Tema", region: "Greater Accra" }), "same_region");
  assert.equal(distanceBand({ city: "Accra", region: "Greater Accra" }, { city: "Kumasi", region: "Ashanti" }), "other_region");
  assert.equal(distanceBand({ city: null, region: null }, { city: "Accra", region: "Greater Accra" }), "other_region");
  setDeliveryRate(db, "xl", "other_region", 45_000);
  assert.deepEqual(quoteDelivery(db, "xl", { city: "Accra", region: "Greater Accra" }, { city: "Tamale", region: "Northern" }), {
    band: "other_region",
    feeCents: 45_000,
  });

  const seller = registerUser(db, "s@example.com", "Seller", "password123");
  const buyer = registerUser(db, "b@example.com", "Buyer", "password123");
  setDeliveryRate(db, "small", "same_city", 2_000);
  setDeliveryRate(db, "small", "other_region", 6_000);
  const t0 = Date.now();
  const id = createAuction(db, {
    sellerId: seller.id, title: "Phone", description: "Works", category: "Other", condition: "Used - Good", imagePath: null,
    size: "small", pickupCity: "Accra", pickupRegion: "Greater Accra", startingBidCents: 50_000, minIncrementCents: 1_000, endsAt: t0 + HOUR,
  }, t0);
  placeBid(db, id, buyer.id, 50_000, t0 + 1);
  closeDueAuctions(db, t0 + HOUR);
  let o = getOrderForAuction(db, id)!;
  assert.equal(o.delivery_fee_cents, 0, "not priced until there's an address");
  const addr = { name: "B", phone: "0240000000", line1: "1 St", city: "Kumasi", region: "Ashanti", country: "Ghana" };
  setShippingAddress(db, o.id, buyer.id, addr);
  o = getOrderForAuction(db, id)!;
  assert.deepEqual([o.delivery_fee_cents, o.return_fee_cents, o.total_cents], [6_000, 6_000, 56_000]);
  setShippingAddress(db, o.id, buyer.id, { ...addr, city: "Accra", region: "Greater Accra" });
  o = getOrderForAuction(db, id)!;
  assert.deepEqual([o.delivery_fee_cents, o.return_fee_cents, o.total_cents], [2_000, 2_000, 52_000]);
});

test("phone numbers are normalised to +233", () => {
  assert.equal(normalizePhone("024 123 4567"), "+233241234567");
  assert.equal(normalizePhone("233241234567"), "+233241234567");
  assert.equal(normalizePhone("+44 7700 900123"), "+447700900123");
  assert.equal(normalizePhone("12345"), null);
});

test("phone check: wrong codes count, limits apply, one account per number", () => {
  const db = fresh();
  const a = registerUser(db, "a@example.com", "Ama", "password123");
  const b = registerUser(db, "b@example.com", "Kofi", "password123");
  const t = Date.now();
  const { code, phone } = startPhoneCheck(db, a.id, "0241234567", t);
  assert.equal(phone, "+233241234567");
  assert.throws(() => startPhoneCheck(db, a.id, "0241234567", t + 1000), /Wait \d+ seconds/);
  const wrong = code === "000000" ? "111111" : "000000";
  const r = confirmPhoneCode(db, a.id, wrong, t + 2000);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /4 tries left/);
  assert.equal(confirmPhoneCode(db, a.id, code, t + 3000).ok, true);
  assert.equal(verificationFor(db, a.id).phoneVerified, true);
  assert.throws(() => startPhoneCheck(db, b.id, "+233 24 123 4567", t), /another Bidwell account/);

  const c2 = startPhoneCheck(db, b.id, "0207654321", t);
  assert.throws(() => confirmPhoneCode(db, b.id, c2.code, t + 11 * 60_000), /expired/);
  for (let i = 0; i < 5; i++) confirmPhoneCode(db, b.id, "999999" === c2.code ? "888888" : "999999", t);
  assert.throws(() => confirmPhoneCode(db, b.id, c2.code, t), /Too many wrong codes/);
});

test("ID check: phone first, admin decides, one account per ID, bidding needs both", () => {
  const db = fresh();
  const a = registerUser(db, "a@example.com", "Ama Owusu", "password123");
  const b = registerUser(db, "b@example.com", "Someone Else", "password123");
  const admin = registerUser(db, "admin@example.com", "Admin", "password123");
  const id = { docType: "ghana_card", docNumber: "GHA-123456789-0", fullName: "Ama Owusu", dateOfBirth: "1990-04-01", frontPath: "f.jpg", backPath: "b.jpg", selfiePath: "s.jpg" };

  assert.throws(() => assertVerified(db, a.id, "bid"), /confirm your phone number/);
  assert.throws(() => submitIdCheck(db, a.id, id), /phone number first/);
  const { code } = startPhoneCheck(db, a.id, "0241234567");
  confirmPhoneCode(db, a.id, code);
  assert.throws(() => submitIdCheck(db, a.id, { ...id, docNumber: "12345" }), /GHA-123456789-0/);
  assert.throws(() => submitIdCheck(db, a.id, { ...id, dateOfBirth: new Date(Date.now() - 10 * 365 * 86_400_000).toISOString().slice(0, 10) }), /18 or older/);
  const first = submitIdCheck(db, a.id, id);
  assert.equal(verificationFor(db, a.id).idStatus, "pending");
  assert.throws(() => assertVerified(db, a.id, "bid"), /wait for your ID check/);
  assert.throws(() => reviewIdCheck(db, first, admin.id, false, ""), /why/);
  reviewIdCheck(db, first, admin.id, false, "Selfie is blurry");
  assert.deepEqual([verificationFor(db, a.id).idStatus, verificationFor(db, a.id).idReason], ["rejected", "Selfie is blurry"]);
  const second = submitIdCheck(db, a.id, id);
  reviewIdCheck(db, second, admin.id, true, "");
  assert.equal(verificationFor(db, a.id).verified, true);
  assert.doesNotThrow(() => assertVerified(db, a.id, "bid"));
  assert.throws(() => reviewIdCheck(db, second, admin.id, true, ""), /already been decided/);

  const c = startPhoneCheck(db, b.id, "0201112222");
  confirmPhoneCode(db, b.id, c.code);
  assert.throws(() => submitIdCheck(db, b.id, { ...id, docNumber: "gha-123456789-0" }), /already linked to another/);
});
