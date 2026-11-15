/**
 * A payment provider the winner can pay through. Paystack is the first; adding another
 * (Flutterwave, Stripe, ...) means writing one more object that satisfies this and
 * registering it in ./index.ts.
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
  /** Checks a webhook's signature and returns the reference it is about, or null to reject it. */
  parseWebhook(rawBody: string, headers: Headers): { reference: string } | null;
}

export type VerifyResult = {
  status: "success" | "failed" | "pending";
  amountCents: number;
  currency: string;
  providerRef?: string;
};
