import type { Auction, Bid } from "./auctions.ts";
import { minimumNextBid } from "./money.ts";
import { maskName } from "./format.ts";

export type Snapshot = ReturnType<typeof snapshot>;

export function snapshot(
  a: Auction,
  bids: Bid[],
  meId: number | null
) {
  return {
    id: a.id,
    status: a.status,
    ends_at: a.ends_at,
    current_bid_cents: a.current_bid_cents,
    starting_bid_cents: a.starting_bid_cents,
    min_increment_cents: a.min_increment_cents,
    bid_count: a.bid_count,
    min_next_cents: minimumNextBid(a),
    leading: meId != null && a.current_bidder_id === meId,
    winner_is_me: meId != null && a.winner_id === meId,
    bids: bids.map((b) => ({
      id: b.id,
      who: b.user_id === meId ? "You" : maskName(b.bidder_name),
      amount_cents: b.amount_cents,
      at: b.created_at,
    })),
  };
}
