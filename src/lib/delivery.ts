import type { DatabaseSync } from "node:sqlite";
import { BANDS, SIZES, type DistanceBand, type ItemSize } from "./places.ts";

/**
 * Delivery is priced by the item's size and how far it travels. Until Bidwell has a maps
 * provider for road distance, distance is measured in bands: same city, same region, or
 * another region. Admins set the price of every size and band on /admin.
 */

/** Starting prices (in GHS) used until an admin sets real ones. Placeholders, not agreed rates. */
const DEFAULT_RATES: Record<ItemSize, Record<DistanceBand, number>> = {
  small: { same_city: 25, same_region: 35, other_region: 60 },
  medium: { same_city: 35, same_region: 50, other_region: 90 },
  large: { same_city: 60, same_region: 90, other_region: 150 },
  xl: { same_city: 150, same_region: 220, other_region: 400 },
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function distanceBand(
  from: { city: string | null; region: string | null },
  to: { city: string | null; region: string | null }
): DistanceBand {
  if (!norm(from.region) || norm(from.region) !== norm(to.region)) return "other_region";
  return norm(from.city) && norm(from.city) === norm(to.city) ? "same_city" : "same_region";
}

export type RateTable = Record<ItemSize, Record<DistanceBand, number>>;

export function deliveryRates(db: DatabaseSync): RateTable {
  const rows = db.prepare(`SELECT size, band, fee_cents FROM delivery_rates`).all() as {
    size: ItemSize;
    band: DistanceBand;
    fee_cents: number;
  }[];
  const t = {} as RateTable;
  for (const s of SIZES) {
    t[s.value] = {} as Record<DistanceBand, number>;
    for (const b of BANDS) t[s.value][b.value] = DEFAULT_RATES[s.value][b.value] * 100;
  }
  for (const r of rows) if (t[r.size]?.[r.band] != null) t[r.size][r.band] = r.fee_cents;
  return t;
}

export function setDeliveryRate(db: DatabaseSync, size: ItemSize, band: DistanceBand, feeCents: number, now = Date.now()) {
  if (!SIZES.some((s) => s.value === size) || !BANDS.some((b) => b.value === band)) throw new Error("unknown size or band");
  if (!Number.isInteger(feeCents) || feeCents < 0) throw new Error("fee must be a whole number of cents, zero or more");
  db.prepare(
    `INSERT INTO delivery_rates (size, band, fee_cents, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (size, band) DO UPDATE SET fee_cents = excluded.fee_cents, updated_at = excluded.updated_at`
  ).run(size, band, feeCents, now);
}

export function quoteDelivery(
  db: DatabaseSync,
  size: string,
  from: { city: string | null; region: string | null },
  to: { city: string | null; region: string | null }
): { band: DistanceBand; feeCents: number } {
  const band = distanceBand(from, to);
  const rates = deliveryRates(db);
  const s = (SIZES.some((x) => x.value === size) ? size : "medium") as ItemSize;
  return { band, feeCents: rates[s][band] };
}
