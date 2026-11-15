import type { Bank, PaymentProvider } from "./types.ts";

const BANKS: Bank[] = [
  { code: "MTN", name: "MTN Mobile Money", type: "mobile_money" },
  { code: "VOD", name: "Telecel Cash", type: "mobile_money" },
  { code: "ATL", name: "AirtelTigo Money", type: "mobile_money" },
  { code: "GCB", name: "GCB Bank", type: "bank" },
  { code: "ECO", name: "Ecobank", type: "bank" },
  { code: "STB", name: "Stanbic Bank", type: "bank" },
];

/**
 * A pretend provider for trying the site without real keys. Only active when PAYMENTS_DEMO=1.
 * Never enable it in production: anyone could "pay" with it. Its checkout page records the
 * payment directly, so verify() only ever reports "pending". Refunds and payouts succeed at once.
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
  async refund() {
    return { status: "processed", providerRef: "demo-refund" };
  },
  payouts: {
    async listBanks() {
      return BANKS;
    },
    async createRecipient({ accountNumber }) {
      return `RCP_demo_${accountNumber.slice(-4)}`;
    },
    async transfer({ reference }) {
      return { status: "paid", providerRef: `demo-${reference}` };
    },
  },
};
