import Link from "next/link";
import type { Auction } from "@/lib/auctions.ts";
import { formatMoney } from "@/lib/money.ts";
import Countdown from "./Countdown.tsx";

export default function AuctionCard({ a }: { a: Auction }) {
  const price = a.current_bid_cents ?? a.starting_bid_cents;
  return (
    <Link href={`/auctions/${a.id}`} className="card item">
      {a.image_path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.image_path} alt="" className="thumb" />
      ) : (
        <div className="thumb empty">No photo</div>
      )}
      <div className="body">
        <div className="title">{a.title}</div>
        <div className="row small muted">
          <span className="pill">{a.condition}</span>
          <span>{a.category}</span>
        </div>
        <div className="spread">
          <span className="price">{formatMoney(price)}</span>
          <span className="small muted">
            {a.bid_count === 0 ? "Starting bid" : `${a.bid_count} bid${a.bid_count === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="small muted">
          {a.status === "active" ? (
            <>
              Ends in <Countdown endsAt={a.ends_at} />
            </>
          ) : a.status === "ended" ? (
            a.winner_id ? "Sold" : "Ended with no bids"
          ) : (
            "Cancelled"
          )}
        </div>
      </div>
    </Link>
  );
}
