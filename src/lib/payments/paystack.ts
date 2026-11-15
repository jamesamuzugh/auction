import crypto from "node:crypto";
import type { Bank, PaymentProvider, VerifyResult, WebhookEvent } from "./types.ts";

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

  parseWebhook(rawBody, headers): WebhookEvent | null {
    const sig = headers.get("x-paystack-signature") ?? "";
    const expected = crypto.createHmac("sha512", secret()).update(rawBody).digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const evt = JSON.parse(rawBody) as {
      event?: string;
      data?: { reference?: string; transaction_reference?: string; reason?: string; transaction?: { reference?: string } };
    };
    const d = evt.data ?? {};
    switch (evt.event) {
      case "charge.success":
        return d.reference ? { kind: "charge", reference: d.reference } : null;
      case "transfer.success":
        return d.reference ? { kind: "transfer", reference: d.reference, status: "paid" } : null;
      case "transfer.failed":
      case "transfer.reversed":
        return d.reference ? { kind: "transfer", reference: d.reference, status: "failed", message: evt.event } : null;
      case "refund.processed":
      case "refund.failed": {
        const ref = d.transaction_reference ?? d.transaction?.reference;
        return ref ? { kind: "refund", reference: ref, status: evt.event === "refund.processed" ? "processed" : "failed" } : null;
      }
      default:
        return null;
    }
  },

  async refund(paymentReference, amountCents) {
    try {
      const d = await call<{ id: number; status: string }>("/refund", {
        method: "POST",
        body: JSON.stringify({ transaction: paymentReference, amount: amountCents }),
      });
      return {
        status: d.status === "processed" ? "processed" : d.status === "failed" ? "failed" : "processing",
        providerRef: String(d.id),
      };
    } catch (e) {
      return { status: "failed", message: (e as Error).message };
    }
  },

  payouts: {
    async listBanks(currency) {
      const banks = await call<{ name: string; code: string; type: string; active: boolean }[]>(
        `/bank?currency=${encodeURIComponent(currency)}&perPage=200`
      );
      return banks
        .filter((b) => b.active !== false)
        .map((b): Bank => ({ code: b.code, name: b.name, type: b.type === "mobile_money" ? "mobile_money" : "bank" }));
    },

    async createRecipient({ method, name, accountNumber, bankCode, currency }) {
      const type = method === "mobile_money" ? "mobile_money" : BANK_RECIPIENT_TYPE[currency] ?? "nuban";
      const d = await call<{ recipient_code: string }>("/transferrecipient", {
        method: "POST",
        body: JSON.stringify({ type, name, account_number: accountNumber, bank_code: bankCode, currency }),
      });
      return d.recipient_code;
    },

    async transfer({ amountCents, currency, recipient, reference, reason }) {
      try {
        const d = await call<{ status: string; transfer_code: string }>("/transfer", {
          method: "POST",
          body: JSON.stringify({ source: "balance", amount: amountCents, currency, recipient, reference, reason }),
        });
        if (d.status === "success") return { status: "paid", providerRef: d.transfer_code };
        if (d.status === "failed" || d.status === "abandoned") return { status: "failed", providerRef: d.transfer_code };
        if (d.status === "otp")
          return { status: "failed", message: "Paystack wants an OTP for transfers. Turn off transfer OTP in Paystack settings." };
        return { status: "processing", providerRef: d.transfer_code };
      } catch (e) {
        return { status: "failed", message: (e as Error).message };
      }
    },
  },
};

/** Paystack's recipient type for a bank account in each currency. */
const BANK_RECIPIENT_TYPE: Record<string, string> = { NGN: "nuban", GHS: "ghipss", ZAR: "basa", KES: "kepss" };
