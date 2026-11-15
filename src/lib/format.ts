/** Shows "Alice" as "A***e" so bidders stay anonymous to each other. */
export function maskName(name: string): string {
  const n = name.trim();
  if (n.length <= 2) return n[0] + "*";
  return `${n[0]}***${n[n.length - 1]}`;
}

export function timeLeft(ms: number): string {
  if (ms <= 0) return "Ended";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

export const ORDER_STEPS = [
  { key: "awaiting_address", label: "Address" },
  { key: "awaiting_payment", label: "Payment" },
  { key: "paid", label: "Paid" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
] as const;

export const ORDER_LABEL: Record<string, string> = {
  awaiting_address: "Needs shipping address",
  awaiting_payment: "Awaiting payment",
  paid: "Paid, preparing to ship",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
