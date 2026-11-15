import { notFound } from "next/navigation";
import { db, currentUser } from "@/lib/server.ts";
import { getAuction, getOrderForAuction, listBids } from "@/lib/auctions.ts";
import { snapshot } from "@/lib/snapshot.ts";
import { formatMoney } from "@/lib/money.ts";
import { dateTime } from "@/lib/format.ts";
import { cancelAuctionAction } from "@/app/actions.ts";
import BidPanel from "@/components/BidPanel.tsx";

export const dynamic = "force-dynamic";

export default async function AuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = db();
  const a = getAuction(d, Number(id));
  if (!a) notFound();
  const me = await currentUser();
  const isSeller = me?.id === a.seller_id;
  const order = getOrderForAuction(d, a.id);
  const canSeeOrder = order && me && (me.id === order.buyer_id || me.id === order.seller_id);

  return (
    <div className="detail">
      <div>
        <div className="photo">
          {a.image_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.image_path} alt={a.title} />
          ) : (
            <div className="thumb empty">No photo</div>
          )}
        </div>
        <h1 style={{ marginTop: 18 }}>{a.title}</h1>
        <div className="row small muted">
          <span className="pill">{a.condition}</span>
          <span>{a.category}</span>
          <span>·</span>
          <span>Sold by {a.seller_name}</span>
        </div>
        <h2>About this item</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{a.description}</p>
        <h2>Auction terms</h2>
        <table className="list">
          <tbody>
            <tr><th>Starting bid</th><td>{formatMoney(a.starting_bid_cents)}</td></tr>
            <tr><th>Minimum increment</th><td>{formatMoney(a.min_increment_cents)}</td></tr>
            <tr><th>Started</th><td>{dateTime(a.starts_at)}</td></tr>
            <tr><th>Ends</th><td>{dateTime(a.ends_at)}</td></tr>
          </tbody>
        </table>
        {isSeller && a.status === "active" && a.bid_count === 0 && (
          <form action={cancelAuctionAction} style={{ marginTop: 16 }}>
            <input type="hidden" name="auction_id" value={a.id} />
            <button className="btn">Cancel listing</button>
          </form>
        )}
      </div>
      <BidPanel
        initial={snapshot(a, listBids(d, a.id, 20), me?.id ?? null)}
        signedIn={!!me}
        isSeller={isSeller}
        orderId={canSeeOrder ? order.id : null}
      />
    </div>
  );
}
