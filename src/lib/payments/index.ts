import { paystack } from "./paystack.ts";
import { demo } from "./demo.ts";
import type { PaymentProvider } from "./types.ts";

/** Every provider the site knows about, in the order buttons are shown. Add new ones here. */
const ALL: PaymentProvider[] = [paystack, demo];

export function getProvider(id: string | null | undefined): PaymentProvider | undefined {
  return ALL.find((p) => p.id === id && p.isConfigured());
}

/** Providers that are configured and can charge in the given currency. */
export function availableProviders(currency: string): PaymentProvider[] {
  return ALL.filter((p) => p.isConfigured() && (p.currencies.includes("*") || p.currencies.includes(currency)));
}

/**
 * The provider that pays sellers out of Bidwell's balance: PAYOUT_PROVIDER if set, otherwise
 * the first configured provider that supports payouts.
 */
export function payoutProvider(): PaymentProvider | undefined {
  const wanted = process.env.PAYOUT_PROVIDER;
  return ALL.find((p) => p.isConfigured() && p.payouts && (!wanted || p.id === wanted));
}

export type { PaymentProvider, Bank } from "./types.ts";
