import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { getDb } from "../src/lib/db.ts";
import { registerUser } from "../src/lib/users.ts";
import {
  applyPaymentResult,
  closeDueAuctions,
  createAuction,
  createPayment,
  getOrderForAuction,
  placeBid,
  setShippingAddress,
} from "../src/lib/auctions.ts";
import { paystack } from "../src/lib/payments/paystack.ts";

const HOUR = 3_600_000;

function wonOrder() {
  const db = getDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "auction-pay-")), "t.db"));
  const seller = registerUser(db, "s@example.com", "Seller", "password123");
  const buyer = registerUser(db, "b@example.com", "Buyer", "password123");
  const t0 = Date.now();
  const id = createAuction(
    db,
    { sellerId: seller.id, title: "Lamp", description: "Works", category: "Other", condition: "Used - Good",
      imagePath: null, startingBidCents: 2000, minIncrementCents: 100, endsAt: t0 + HOUR },
    t0
  );
  placeBid(db, id, buyer.id, 2500, t0 + 1);
  closeDueAuctions(db, t0 + HOUR);
  const order = getOrderForAuction(db, id)!;
  return { db, seller, buyer, order, id };
}

const addr = { name: "B", phone: "1", line1: "1 St", city: "Accra", region: "GA", country: "Ghana" };

test("payment needs an address first and only the winner can pay", () => {
  const { db, seller, buyer, order } = wonOrder();
  assert.throws(() => createPayment(db, order.id, buyer.id, "paystack", "GHS"), /shipping address/);
  setShippingAddress(db, order.id, buyer.id, addr);
  assert.throws(() => createPayment(db, order.id, seller.id, "paystack", "GHS"), /Only the winner/);
  const p = createPayment(db, order.id, buyer.id, "paystack", "GHS");
  assert.equal(p.amount_cents, 2500);
  assert.equal(p.buyer_email, "b@example.com");
});

test("verified success marks the order paid, once, even if reported twice", () => {
  const { db, buyer, order, id } = wonOrder();
  setShippingAddress(db, order.id, buyer.id, addr);
  const p = createPayment(db, order.id, buyer.id, "paystack", "GHS");
  const ok = { status: "success" as const, amountCents: 2500, currency: "GHS", providerRef: "99" };
  assert.equal(applyPaymentResult(db, p.reference, ok, "Paystack").outcome, "paid");
  assert.equal(applyPaymentResult(db, p.reference, ok, "Paystack").outcome, "already_paid");
  assert.equal(getOrderForAuction(db, id)!.status, "paid");
  assert.throws(() => createPayment(db, order.id, buyer.id, "paystack", "GHS"), /already been paid/);
});

test("an underpayment or wrong currency doesn't mark the order paid", () => {
  const { db, buyer, order, id } = wonOrder();
  setShippingAddress(db, order.id, buyer.id, addr);
  const p1 = createPayment(db, order.id, buyer.id, "paystack", "GHS");
  assert.equal(applyPaymentResult(db, p1.reference, { status: "success", amountCents: 100, currency: "GHS" }, "P").outcome, "mismatch");
  const p2 = createPayment(db, order.id, buyer.id, "paystack", "GHS");
  assert.equal(applyPaymentResult(db, p2.reference, { status: "success", amountCents: 2500, currency: "NGN" }, "P").outcome, "mismatch");
  const p3 = createPayment(db, order.id, buyer.id, "paystack", "GHS");
  assert.equal(applyPaymentResult(db, p3.reference, { status: "failed", amountCents: 2500, currency: "GHS" }, "P").outcome, "failed");
  assert.equal(getOrderForAuction(db, id)!.status, "awaiting_payment");
});

test("Paystack webhook signature is checked", () => {
  process.env.PAYSTACK_SECRET_KEY = "sk_test_abc";
  const body = JSON.stringify({ event: "charge.success", data: { reference: "ord1-x" } });
  const sig = crypto.createHmac("sha512", "sk_test_abc").update(body).digest("hex");
  assert.deepEqual(paystack.parseWebhook(body, new Headers({ "x-paystack-signature": sig })), { kind: "charge", reference: "ord1-x" });
  const signed = (o: object) => {
    const b = JSON.stringify(o);
    return paystack.parseWebhook(b, new Headers({ "x-paystack-signature": crypto.createHmac("sha512", "sk_test_abc").update(b).digest("hex") }));
  };
  assert.deepEqual(signed({ event: "transfer.success", data: { reference: "payout-1" } }), { kind: "transfer", reference: "payout-1", status: "paid" });
  assert.deepEqual(signed({ event: "transfer.reversed", data: { reference: "payout-1" } }), { kind: "transfer", reference: "payout-1", status: "failed", message: "transfer.reversed" });
  assert.deepEqual(signed({ event: "refund.processed", data: { transaction_reference: "ord1-x" } }), { kind: "refund", reference: "ord1-x", status: "processed" });
  assert.equal(paystack.parseWebhook(body, new Headers({ "x-paystack-signature": "0".repeat(128) })), null);
  assert.equal(paystack.parseWebhook(body + " ", new Headers({ "x-paystack-signature": sig })), null);
});

test("Paystack initialize and verify talk to the right endpoints", async () => {
  process.env.PAYSTACK_SECRET_KEY = "sk_test_abc";
  const calls: { url: string; init?: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const data = url.includes("initialize")
      ? { authorization_url: "https://checkout.paystack.com/abc" }
      : { status: "success", amount: 2500, currency: "GHS", id: 42 };
    return new Response(JSON.stringify({ status: true, data }), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await paystack.initialize({ reference: "ref1", amountCents: 2500, currency: "GHS", email: "b@example.com",
      callbackUrl: "http://x/cb", metadata: {} });
    assert.equal(r.redirectUrl, "https://checkout.paystack.com/abc");
    assert.equal(calls[0].url, "https://api.paystack.co/transaction/initialize");
    assert.equal((calls[0].init!.headers as Record<string, string>).Authorization, "Bearer sk_test_abc");
    assert.equal(JSON.parse(String(calls[0].init!.body)).amount, 2500);
    const v = await paystack.verify("ref1");
    assert.deepEqual(v, { status: "success", amountCents: 2500, currency: "GHS", providerRef: "42" });
    assert.equal(calls[1].url, "https://api.paystack.co/transaction/verify/ref1");
  } finally {
    globalThis.fetch = real;
  }
});

test("Paystack payouts and refunds call the right endpoints", async () => {
  process.env.PAYSTACK_SECRET_KEY = "sk_test_abc";
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const data = url.includes("/bank")
      ? [{ name: "MTN", code: "MTN", type: "mobile_money", active: true }, { name: "GCB Bank", code: "040100", type: "ghipss", active: true }]
      : url.includes("transferrecipient")
        ? { recipient_code: "RCP_1" }
        : url.includes("/transfer")
          ? { status: "otp", transfer_code: "TRF_1" }
          : { id: 7, status: "pending" };
    return new Response(JSON.stringify({ status: true, data }), { status: 200 });
  }) as typeof fetch;
  try {
    const banks = await paystack.payouts!.listBanks("GHS");
    assert.deepEqual(banks.map((b) => b.type), ["mobile_money", "bank"]);
    assert.equal(await paystack.payouts!.createRecipient({ method: "bank", name: "S", accountNumber: "123", bankCode: "040100", currency: "GHS" }), "RCP_1");
    assert.equal(calls[1].body.type, "ghipss");
    const t = await paystack.payouts!.transfer({ amountCents: 9500, currency: "GHS", recipient: "RCP_1", reference: "payout-1", reason: "x" });
    assert.equal(t.status, "failed");
    assert.match(t.message!, /OTP/);
    assert.deepEqual(calls[2].body, { source: "balance", amount: 9500, currency: "GHS", recipient: "RCP_1", reference: "payout-1", reason: "x" });
    const r = await paystack.refund("ord1-x", 2500);
    assert.deepEqual(r, { status: "processing", providerRef: "7" });
    assert.deepEqual(calls[3].body, { transaction: "ord1-x", amount: 2500 });
  } finally {
    globalThis.fetch = real;
  }
});
