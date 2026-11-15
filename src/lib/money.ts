// Safe to import from client components: no server-only dependencies.

export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY ?? "USD";

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en", { style: "currency", currency: CURRENCY }).format(cents / 100);
}

/** Parses "12", "12.5", "1,200.00" into integer cents. Returns NaN for anything else. */
export function parseMoney(input: string): number {
  const s = input.replace(/[,\s]/g, "").replace(/^[^\d.]+/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

/** The lowest amount the next bid may be. */
export function minimumNextBid(a: { current_bid_cents: number | null; starting_bid_cents: number; min_increment_cents: number }): number {
  return a.current_bid_cents == null ? a.starting_bid_cents : a.current_bid_cents + a.min_increment_cents;
}

/** Flat delivery fee the winner pays on top of the winning bid (goes to the delivery partner). */
export function deliveryFeeCents(): number {
  const n = Number(process.env.DELIVERY_FEE ?? 30);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

/** Cost of bringing an undeliverable item back to the seller, charged to the winner. Defaults to the delivery fee. */
export function returnFeeCents(): number {
  const n = Number(process.env.RETURN_FEE ?? process.env.DELIVERY_FEE ?? 30);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}
