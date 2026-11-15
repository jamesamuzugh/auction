/**
 * A payment provider. Paystack is the first; adding another (Flutterwave, Stripe, ...) means
 * writing one more object that satisfies this and registering it in ./index.ts.
 *
 * Bidwell works as escrow: buyers pay Bidwell, Bidwell holds the money, then either pays the
 * seller out (transfer) or gives it back to the buyer (refund).
 */
export interface PaymentProvider {
  /** Stable id used in URLs and stored on payments, e.g. "paystack". */
  id: string;
  /** Short name for order history, e.g. "Paystack". */
  name: string;
  /** Button label shown to the winner. */
  label: string;
  /** Currencies this provider can charge in (ISO codes). */
  currencies: string[];
  /** True when the keys it needs are set. Unconfigured providers are hidden. */
  isConfigured(): boolean;
  /** Starts a checkout and returns where to send the payer. */
  initialize(input: {
    reference: string;
    amountCents: number;
    currency: string;
    email: string;
    callbackUrl: string;
    metadata: Record<string, string | number>;
  }): Promise<{ redirectUrl: string }>;
  /** Asks the provider whether a payment really succeeded. Never trust the redirect alone. */
  verify(reference: string): Promise<VerifyResult>;
  /** Checks a webhook's signature and says what it is about, or null to reject it. */
  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
  /** Gives a captured payment back to the buyer. */
  refund(paymentReference: string, amountCents: number): Promise<{ status: "processed" | "processing" | "failed"; providerRef?: string; message?: string }>;
  /** Sending money to sellers. Optional: a provider without it can still take payments. */
  payouts?: PayoutSupport;
}

export interface PayoutSupport {
  /** Banks and mobile money networks a seller can be paid into. */
  listBanks(currency: string): Promise<Bank[]>;
  /** Registers the seller's account with the provider and returns its recipient code. */
  createRecipient(input: {
    method: "bank" | "mobile_money";
    name: string;
    accountNumber: string;
    bankCode: string;
    currency: string;
  }): Promise<string>;
  /** Sends money from Bidwell's balance to a recipient. */
  transfer(input: {
    amountCents: number;
    currency: string;
    recipient: string;
    reference: string;
    reason: string;
  }): Promise<{ status: "paid" | "processing" | "failed"; providerRef?: string; message?: string }>;
}

export type Bank = { code: string; name: string; type: "bank" | "mobile_money" };

export type WebhookEvent =
  | { kind: "charge"; reference: string }
  | { kind: "transfer"; reference: string; status: "paid" | "failed"; message?: string }
  | { kind: "refund"; reference: string; status: "processed" | "failed" };

export type VerifyResult = {
  status: "success" | "failed" | "pending";
  amountCents: number;
  currency: string;
  providerRef?: string;
};
