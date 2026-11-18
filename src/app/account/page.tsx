import Link from "next/link";
import { db, requireUser } from "@/lib/server.ts";
import { auctionsBidOnBy, auctionsSoldBy, ordersForBuyer } from "@/lib/auctions.ts";
import { formatMoney } from "@/lib/money.ts";
import { ORDER_LABEL } from "@/lib/format.ts";
import Countdown from "@/components/Countdown.tsx";
import { verificationFor } from "@/lib/verify.ts";

export const dynamic = "force-dynamic";

function OrderPill({ status }: { status: string }) {
  const cls = ["completed", "refunded"].includes(status) ? "ok" : ["awaiting_address", "disputed"].includes(status) ? "err" : "accent";
  return <span className={`pill ${cls}`}>{ORDER_LABEL[status] ?? status}</span>;
}

export default async function Account() {
  const me = await requireUser("/account");
  const d = db();
  const won = ordersForBuyer(d, me.id);
  const bids = auctionsBidOnBy(d, me.id).filter((a) => a.status === "active");
  const selling = auctionsSoldBy(d, me.id);
  const v = verificationFor(d, me.id);

  return (
    <>
      <h1>Hi, {me.name}</h1>
      <div className="spread">
        <p className="muted" style={{ margin: 0 }}>{me.email}</p>
        <Link href="/account/payouts" className="btn">Payouts and payout details</Link>
      </div>
      {v.verified ? (
        <p className="small" style={{ marginTop: 8 }}><span className="pill ok">Verified</span> Phone and ID checked</p>
      ) : (
        <div className="card pad spread" style={{ marginTop: 14 }}>
          <span>
            {v.idStatus === "pending"
              ? "Your ID is being checked. You can bid and sell once it's approved."
              : v.idStatus === "rejected"
                ? "Your ID check wasn't approved. Please send it again."
                : "Verify your phone and ID to start bidding and selling."}
          </span>
          <Link className="btn primary" href="/account/verify">{v.idStatus === "pending" ? "See status" : "Verify now"}</Link>
        </div>
      )}

      <h2>Items you won</h2>
      <div className="card table-wrap">
        {won.length === 0 ? (
          <div className="empty-state">Nothing won yet.</div>
        ) : (
          <table className="list">
            <thead><tr><th>Item</th><th>Winning bid</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {won.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/auctions/${o.auction_id}`}>{o.auction_title}</Link></td>
                  <td>{formatMoney(o.amount_cents)}</td>
                  <td><OrderPill status={o.status} /></td>
                  <td><Link className="btn" href={`/orders/${o.id}`}>{o.status === "awaiting_address" ? "Add address" : "Track"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Auctions you're bidding on</h2>
      <div className="card table-wrap">
        {bids.length === 0 ? (
          <div className="empty-state">No active bids. <Link href="/">Browse auctions</Link></div>
        ) : (
          <table className="list">
            <thead><tr><th>Item</th><th>Your top bid</th><th>Current bid</th><th>Ends in</th></tr></thead>
            <tbody>
              {bids.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/auctions/${a.id}`}>{a.title}</Link></td>
                  <td>{formatMoney(a.my_max_cents)}</td>
                  <td>
                    {formatMoney(a.current_bid_cents!)}{" "}
                    {a.current_bidder_id === me.id ? <span className="pill ok">Leading</span> : <span className="pill err">Outbid</span>}
                  </td>
                  <td><Countdown endsAt={a.ends_at} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Your listings</h2>
      <div className="card table-wrap">
        {selling.length === 0 ? (
          <div className="empty-state">You haven't listed anything. <Link href="/sell">Sell an item</Link></div>
        ) : (
          <table className="list">
            <thead><tr><th>Item</th><th>Price</th><th>Bids</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {selling.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/auctions/${a.id}`}>{a.title}</Link></td>
                  <td>{formatMoney(a.current_bid_cents ?? a.starting_bid_cents)}</td>
                  <td>{a.bid_count}</td>
                  <td>
                    {a.status === "active" ? (
                      <>Ends in <Countdown endsAt={a.ends_at} /></>
                    ) : a.order_status ? (
                      <OrderPill status={a.order_status} />
                    ) : a.status === "cancelled" ? (
                      <span className="pill">Cancelled</span>
                    ) : (
                      <span className="pill">No bids</span>
                    )}
                  </td>
                  <td>{a.order_id && <Link className="btn" href={`/orders/${a.order_id}`}>Manage</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
