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
