import crypto from "node:crypto";
import type { PaymentProvider, VerifyResult } from "./types.ts";

const API = "https://api.paystack.co";

function secret(): string {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return k;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = (await r.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!r.ok || !body.status) throw new Error(`Paystack ${path}: ${body.message ?? r.status}`);
  return body.data as T;
}

/** Paystack (https://paystack.com): cards, bank, USSD and mobile money in NGN, GHS, ZAR, KES and more. */
export const paystack: PaymentProvider = {
  id: "paystack",
  name: "Paystack",
  label: "Pay with Paystack (card, bank or mobile money)",
  currencies: ["NGN", "GHS", "ZAR", "KES", "USD", "XOF", "EGP", "RWF"],
  isConfigured: () => !!process.env.PAYSTACK_SECRET_KEY,

  async initialize({ reference, amountCents, currency, email, callbackUrl, metadata }) {
    // Paystack amounts are in the currency's subunit (kobo, pesewas, cents), same as our cents.
    const data = await call<{ authorization_url: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({ reference, amount: amountCents, currency, email, callback_url: callbackUrl, metadata }),
    });
    return { redirectUrl: data.authorization_url };
  },

  async verify(reference): Promise<VerifyResult> {
    const d = await call<{ status: string; amount: number; currency: string; id: number }>(
      `/transaction/verify/${encodeURIComponent(reference)}`
    );
    return {
      status: d.status === "success" ? "success" : d.status === "failed" || d.status === "abandoned" ? "failed" : "pending",
      amountCents: d.amount,
      currency: d.currency,
      providerRef: String(d.id),
    };
  },

  parseWebhook(rawBody, headers) {
    const sig = headers.get("x-paystack-signature") ?? "";
    const expected = crypto.createHmac("sha512", secret()).update(rawBody).digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const evt = JSON.parse(rawBody) as { event?: string; data?: { reference?: string } };
    if (evt.event !== "charge.success" || !evt.data?.reference) return null;
    return { reference: evt.data.reference };
  },
};
