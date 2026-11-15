"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "@/lib/db.ts";
import { db, currentUser, moveMoney, SESSION_COOKIE, type FormState } from "@/lib/server.ts";
import { authenticate, createSession, deleteSession, registerUser } from "@/lib/users.ts";
import {
  AuctionError,
  CATEGORIES,
  CONDITIONS,
  CURRENCY,
  applyPaymentResult,
  cancelAuction,
  createPayment,
  getPayment,
  createAuction,
  addDeliveryPartner,
  adminConfirmDelivery,
  confirmDeliveryByPartner,
  removeDeliveryPartner,
  markPaidOffline,
  markShipped,
  parseMoney,
  placeBid,
  setShippingAddress,
} from "@/lib/auctions.ts";
import { getProvider } from "@/lib/payments/index.ts";
import {
  DISPUTE_REASONS,
  acceptItem,
  markRefundDoneManually,
  openDispute,
  resolveDispute,
  respondToDispute,
  retryPayout,
  retryRefund,
  savePayoutAccount,
  type Resolution,
} from "@/lib/escrow.ts";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

function safeNext(n: string) {
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

async function startSession(userId: number) {
  const { token, expires } = createSession(getDb(), userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires,
    path: "/",
  });
}

/** Turns expected validation errors into form messages and lets anything else surface. */
function fail(e: unknown): FormState {
  if (e instanceof AuctionError) return { error: e.message };
  throw e;
}

export async function registerAction(_: FormState, f: FormData): Promise<FormState> {
  try {
    const u = registerUser(getDb(), str(f, "email"), str(f, "name"), str(f, "password"));
    await startSession(u.id);
  } catch (e) {
    return fail(e);
  }
  redirect(safeNext(str(f, "next")));
}

export async function loginAction(_: FormState, f: FormData): Promise<FormState> {
  try {
    const u = authenticate(getDb(), str(f, "email"), str(f, "password"));
    await startSession(u.id);
  } catch (e) {
    return fail(e);
  }
  redirect(safeNext(str(f, "next")));
}

export async function logoutAction() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) deleteSession(getDb(), t);
  jar.delete(SESSION_COOKIE);
  redirect("/");
}

const MAX_IMAGE = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export async function createAuctionAction(_: FormState, f: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login?next=/sell");
  let id: number;
  try {
    const startingBidCents = parseMoney(str(f, "starting_bid"));
    const minIncrementCents = parseMoney(str(f, "min_increment"));
    if (Number.isNaN(startingBidCents)) throw new AuctionError("Enter a valid starting bid.");
    if (Number.isNaN(minIncrementCents)) throw new AuctionError("Enter a valid minimum increment.");

    // The browser sends the end time already converted to a UTC timestamp.
    const endsAt = Number(str(f, "ends_at_ms"));
    if (!Number.isFinite(endsAt) || endsAt <= 0) throw new AuctionError("Choose when the auction ends.");

    const category = CATEGORIES.includes(str(f, "category")) ? str(f, "category") : "Other";
    const condition = CONDITIONS.includes(str(f, "condition")) ? str(f, "condition") : "Used - Good";

    let imagePath: string | null = null;
    const file = f.get("image");
    if (file instanceof File && file.size > 0) {
      const ext = IMAGE_TYPES[file.type];
      if (!ext) throw new AuctionError("Photos must be JPG, PNG, WebP or GIF.");
      if (file.size > MAX_IMAGE) throw new AuctionError("Photos must be 5 MB or smaller.");
      const name = `${crypto.randomUUID()}${ext}`;
      const dir = path.join(process.cwd(), "public", "uploads");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
      imagePath = `/uploads/${name}`;
    }

    id = createAuction(getDb(), {
      sellerId: user.id,
      title: str(f, "title").slice(0, 120),
      description: str(f, "description").slice(0, 5000),
      category,
      condition,
      imagePath,
      startingBidCents,
      minIncrementCents,
      endsAt,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/");
  redirect(`/auctions/${id}`);
}

export async function bidAction(_: FormState, f: FormData): Promise<FormState> {
  const auctionId = Number(str(f, "auction_id"));
  const user = await currentUser();
  if (!user) redirect(`/login?next=/auctions/${auctionId}`);
  try {
    const amount = parseMoney(str(f, "amount"));
    if (Number.isNaN(amount)) throw new AuctionError("Enter a valid bid amount.");
    placeBid(db(), auctionId, user.id, amount);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/auctions/${auctionId}`);
  return { ok: "Your bid is in. You're the highest bidder." };
}

export async function cancelAuctionAction(f: FormData) {
  const user = await currentUser();
  const id = Number(str(f, "auction_id"));
  if (!user) redirect(`/login?next=/auctions/${id}`);
  try {
    cancelAuction(db(), id, user.id);
  } catch (e) {
    if (!(e instanceof AuctionError)) throw e;
  }
  revalidatePath("/");
  redirect(`/auctions/${id}`);
}

async function orderUser(f: FormData) {
  const user = await currentUser();
  const orderId = Number(str(f, "order_id"));
  if (!user) redirect(`/login?next=/orders/${orderId}`);
  return { user, orderId };
}

export async function shippingAction(_: FormState, f: FormData): Promise<FormState> {
  const { user, orderId } = await orderUser(f);
  try {
    setShippingAddress(db(), orderId, user.id, {
      name: str(f, "name"),
      phone: str(f, "phone"),
      line1: str(f, "line1"),
      line2: str(f, "line2"),
      city: str(f, "city"),
      region: str(f, "region"),
      postal: str(f, "postal"),
      country: str(f, "country"),
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Shipping address saved." };
}


export async function markShippedAction(_: FormState, f: FormData): Promise<FormState> {
  const { user, orderId } = await orderUser(f);
  try {
    markShipped(db(), orderId, user.id, Number(str(f, "courier_id")), str(f, "tracking"));
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Handed to the delivery partner." };
}

export async function acceptItemAction(_: FormState, f: FormData): Promise<FormState> {
  const { user, orderId } = await orderUser(f);
  try {
    acceptItem(db(), orderId, user.id);
  } catch (e) {
    return fail(e);
  }
  await moveMoney();
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Thanks! The seller has been paid." };
}

/** The delivery partner confirms handover with the winner's code or signature. */
export async function partnerDeliverAction(_: FormState, f: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login?next=/deliveries");
  const orderId = Number(str(f, "order_id"));
  try {
    if (user.role !== "courier") throw new AuctionError("Only delivery partners can confirm deliveries.");
    const recipientName = str(f, "recipient");
    if (str(f, "method") === "signature") {
      confirmDeliveryByPartner(db(), orderId, user.id, { method: "signature", signature: str(f, "signature"), recipientName });
    } else {
      confirmDeliveryByPartner(db(), orderId, user.id, { method: "code", code: str(f, "code"), recipientName });
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/deliveries");
  return { ok: `Order #${orderId} marked as delivered.` };
}

export async function adminConfirmDeliveryAction(_: FormState, f: FormData): Promise<FormState> {
  const orderId = Number(str(f, "order_id"));
  try {
    await adminUser();
    adminConfirmDelivery(db(), orderId, str(f, "note"));
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Delivery confirmed." };
}

export async function partnerAdminAction(_: FormState, f: FormData): Promise<FormState> {
  try {
    await adminUser();
    if (str(f, "op") === "remove") removeDeliveryPartner(getDb(), Number(str(f, "id")));
    else addDeliveryPartner(getDb(), str(f, "email"), str(f, "company"));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin");
  return { ok: "Delivery partners updated." };
}

/* -------------------------------- Payments -------------------------------- */

async function baseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function startPaymentAction(_: FormState, f: FormData): Promise<FormState> {
  const { user, orderId } = await orderUser(f);
  const provider = getProvider(str(f, "provider"));
  let url: string;
  try {
    if (!provider) throw new AuctionError("That payment method isn't available.");
    const p = createPayment(db(), orderId, user.id, provider.id, CURRENCY);
    const r = await provider.initialize({
      reference: p.reference,
      amountCents: p.amount_cents,
      currency: p.currency,
      email: p.buyer_email,
      callbackUrl: `${await baseUrl()}/api/payments/${provider.id}/callback`,
      metadata: { order_id: orderId },
    });
    url = r.redirectUrl;
  } catch (e) {
    if (e instanceof AuctionError) return { error: e.message };
    console.error(e);
    return { error: "We couldn't start the payment. Please try again in a moment." };
  }
  redirect(url);
}

export async function demoPayAction(f: FormData) {
  if (process.env.PAYMENTS_DEMO !== "1") throw new Error("Demo payments are off");
  const d = db();
  const p = getPayment(d, str(f, "reference"));
  if (!p) redirect("/");
  const { orderId, outcome } = applyPaymentResult(
    d,
    p.reference,
    { status: str(f, "result") === "fail" ? "failed" : "success", amountCents: p.amount_cents, currency: p.currency },
    "demo checkout"
  );
  redirect(`/orders/${orderId}?payment=${outcome}`);
}

/* --------------------------------- Disputes -------------------------------- */

export async function openDisputeAction(_: FormState, f: FormData): Promise<FormState> {
  const { user, orderId } = await orderUser(f);
  try {
    const reason = str(f, "reason");
    if (!DISPUTE_REASONS.includes(reason)) throw new AuctionError("Choose what went wrong.");
    openDispute(db(), orderId, user.id, reason, str(f, "details"));
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Problem reported. The money stays with Bidwell until we've reviewed it." };
}

export async function respondDisputeAction(_: FormState, f: FormData): Promise<FormState> {
  const { user, orderId } = await orderUser(f);
  try {
    respondToDispute(db(), Number(str(f, "dispute_id")), user.id, str(f, "response"));
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Response sent to Bidwell." };
}

async function adminUser() {
  const user = await currentUser();
  if (!user?.isAdmin) throw new AuctionError("Only Bidwell admins can do that.");
  return user;
}

export async function resolveDisputeAction(_: FormState, f: FormData): Promise<FormState> {
  const orderId = Number(str(f, "order_id"));
  try {
    const admin = await adminUser();
    const outcome = str(f, "outcome") as Resolution;
    if (!["refund", "release", "resume"].includes(outcome)) throw new AuctionError("Choose a decision.");
    resolveDispute(db(), Number(str(f, "dispute_id")), admin.id, outcome, str(f, "note"));
  } catch (e) {
    return fail(e);
  }
  await moveMoney();
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/admin");
  return { ok: "Decision recorded." };
}

export async function adminMarkPaidAction(_: FormState, f: FormData): Promise<FormState> {
  const orderId = Number(str(f, "order_id"));
  try {
    await adminUser();
    markPaidOffline(db(), orderId, str(f, "note"));
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin");
  revalidatePath(`/orders/${orderId}`);
  return { ok: "Payment recorded and held in escrow." };
}

export async function adminMoneyAction(_: FormState, f: FormData): Promise<FormState> {
  try {
    await adminUser();
    const id = Number(str(f, "id"));
    const op = str(f, "op");
    if (op === "retry_payout") retryPayout(getDb(), id);
    else if (op === "retry_refund") retryRefund(getDb(), id);
    else if (op === "refund_done") markRefundDoneManually(getDb(), id);
    else if (op !== "run") throw new AuctionError("Unknown action.");
    db();
    await moveMoney();
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin");
  return { ok: "Done." };
}

/* ---------------------------------- Payouts --------------------------------- */

export async function savePayoutAccountAction(_: FormState, f: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account/payouts");
  try {
    const [bankCode, bankName] = str(f, "bank").split("|");
    const method = str(f, "method") === "bank" ? "bank" : "mobile_money";
    savePayoutAccount(getDb(), user.id, {
      method,
      bankCode: bankCode ?? "",
      bankName: bankName ?? "",
      accountNumber: str(f, "account_number"),
      accountName: str(f, "account_name"),
    });
  } catch (e) {
    return fail(e);
  }
  await moveMoney();
  revalidatePath("/account/payouts");
  return { ok: "Payout details saved. Released funds will be sent here." };
}
