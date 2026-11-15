import type { PaymentProvider } from "./types.ts";

/**
 * A pretend checkout for trying the site without real keys. Only active when PAYMENTS_DEMO=1.
 * Never enable it in production: anyone could "pay" with it. Its checkout page records the
 * payment directly, so verify() only ever reports "pending".
 */
export const demo: PaymentProvider = {
  id: "demo",
  name: "demo checkout",
  label: "Demo payment (test mode, no real money)",
  currencies: ["*"],
  isConfigured: () => process.env.PAYMENTS_DEMO === "1",
  async initialize({ reference }) {
    return { redirectUrl: `/pay/demo?reference=${encodeURIComponent(reference)}` };
  },
  async verify() {
    return { status: "pending", amountCents: 0, currency: "" };
  },
  parseWebhook: () => null,
};
