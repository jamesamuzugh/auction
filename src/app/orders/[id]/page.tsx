import Link from "next/link";
import { notFound } from "next/navigation";
import { db, moveMoney, requireUser } from "@/lib/server.ts";
import { getOrder, orderEvents } from "@/lib/auctions.ts";
import { formatMoney, CURRENCY } from "@/lib/money.ts";
import { ORDER_LABEL, ORDER_STEPS, dateTime } from "@/lib/format.ts";
import {
  DISPUTE_REASONS,
  canDispute,
  disputesForOrder,
  feeFor,
  getPayoutAccount,
  getPayoutForOrder,
  getRefundForOrder,
} from "@/lib/escrow.ts";
import { availableProviders } from "@/lib/payments/index.ts";
import {
  AddressForm,
  AdminMarkPaidForm,
  DeliveredForm,
  DisputeForm,
  PayForm,
  ResolveForm,
  RespondForm,
  ShipForm,
} from "@/components/OrderForms.tsx";
import Countdown from "@/components/Countdown.tsx";

export const dynamic = "force-dynamic";

const PAYMENT_MSG: Record<string, { ok: boolean; text: string }> = {
  paid: { ok: true, text: "Payment received. Bidwell is holding it until you have your item." },
  already_paid: { ok: true, text: "This order is already paid." },
  failed: { ok: false, text: "The payment didn't go through. You can try again." },
  mismatch: { ok: false, text: "The amount paid didn't match the order. Contact support before trying again." },
  pending: { ok: false, text: "We haven't had confirmation of your payment yet. Refresh in a minute." },
};

const PAYOUT_LABEL: Record<string, string> = {
  waiting_details: "Waiting for the seller's payout details",
  pending: "Queued",
  processing: "On its way",
  paid: "Paid out",
  failed: "Failed, Bidwell will retry",
};

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { id } = await params;
  const paymentMsg = PAYMENT_MSG[(await searchParams).payment ?? ""];
  const me = await requireUser(`/orders/${id}`);
  const d = db();
  await moveMoney();
  const o = getOrder(d, Number(id));
  // Only the buyer, the seller and Bidwell admins can see an order.
  if (!o || (o.buyer_id !== me.id && o.seller_id !== me.id && !me.isAdmin)) notFound();
  const isBuyer = o.buyer_id === me.id;
  const isSeller = o.seller_id === me.id;
  const providers = availableProviders(CURRENCY).map((p) => ({ id: p.id, label: p.label }));
  const events = orderEvents(d, o.id);
  const disputes = disputesForOrder(d, o.id);
  const openDispute = disputes.find((x) => x.status === "open");
  const payout = getPayoutForOrder(d, o.id);
  const refund = getRefundForOrder(d, o.id);
  const fee = payout?.fee_cents ?? feeFor(o.amount_cents);
  const flow = o.status === "completed" ? 5 : ORDER_STEPS.findIndex((s) => s.key === o.status);
  const stepIdx = o.status === "disputed" && openDispute ? ORDER_STEPS.findIndex((s) => s.key === openDispute.prev_status) : flow;
  const releaseWindowOpen = o.status === "delivered" && o.release_at != null;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 18 }}>
      <div>
        <Link href={`/auctions/${o.auction_id}`} className="small muted">← Back to the auction</Link>
        <h1 style={{ marginTop: 8 }}>{o.auction_title}</h1>
        <div className="row muted small">
          <span>Order #{o.id}</span>·<span>Won for <strong style={{ color: "var(--text)" }}>{formatMoney(o.amount_cents)}</strong></span>·
          <span>{isBuyer ? `Seller: ${o.seller_name}` : `Winner: ${o.buyer_name} (${o.buyer_email})`}</span>
          {me.isAdmin && !isBuyer && !isSeller && <span className="pill accent">Admin view · Seller: {o.seller_name}</span>}
        </div>
      </div>

      {paymentMsg && <div className={`msg ${paymentMsg.ok ? "ok" : "err"}`}>{paymentMsg.text}</div>}

      <div className="card pad">
        <div className="spread">
          <strong>{ORDER_LABEL[o.status]}</strong>
          <EscrowPill status={o.escrow_status} />
        </div>
        {o.status !== "refunded" && (
          <div className="steps">
            {ORDER_STEPS.map((s, i) => (
              <div key={s.key} className={`s ${i < stepIdx ? "done" : i === stepIdx ? (o.status === "disputed" ? "hold" : "now") : ""}`}>
                {s.label}
              </div>
            ))}
            <div className={`s ${o.status === "completed" ? "done" : ""}`}>Seller paid</div>
          </div>
        )}
      </div>

      {/* Escrow explainer for whichever side is looking */}
      {["held", "frozen"].includes(o.escrow_status) && (
        <div className="card pad escrow">
          <strong>{formatMoney(o.amount_cents)} is held by Bidwell</strong>
          {o.escrow_status === "frozen" ? (
            <p>Payment is frozen while Bidwell reviews the reported problem. Nobody can move it until a decision is made.</p>
          ) : releaseWindowOpen ? (
            <p>
              Delivery confirmed. The seller is paid in <Countdown endsAt={o.release_at!} refreshOnEnd /> ({dateTime(o.release_at!)}) unless
              the winner reports a problem before then.
            </p>
          ) : isBuyer ? (
            <p>The seller doesn&apos;t get your money until you confirm the item arrived as described, plus 6 hours to report any problem.</p>
          ) : (
            <p>
              You&apos;ll be paid {formatMoney(o.amount_cents - fee)}
              {fee > 0 && <> (after the {formatMoney(fee)} Bidwell fee)</>} 6 hours after the winner confirms delivery. If they don&apos;t
              confirm, delivery is confirmed automatically 7 days after you ship.
            </p>
          )}
        </div>
      )}

      {/* What the current person needs to do next */}
      {isBuyer && o.status === "awaiting_address" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Where should we ship it?</h2>
          <AddressForm order={o} />
        </div>
      )}
      {isBuyer && o.status === "awaiting_payment" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Next: pay {formatMoney(o.amount_cents)}</h2>
          {providers.length > 0 ? (
            <PayForm orderId={o.id} providers={providers} />
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>
              Online payment isn&apos;t switched on yet. Pay Bidwell using the details support sends you; we&apos;ll confirm it here.
            </p>
          )}
        </div>
      )}
      {isBuyer && o.status === "shipped" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Your item is on its way</h2>
          <p style={{ marginTop: 0 }}>
            Shipped with <strong>{o.carrier}</strong>
            {o.tracking_number && <> · Tracking number <strong>{o.tracking_number}</strong></>}
          </p>
          <DeliveredForm orderId={o.id} />
        </div>
      )}
      {isSeller && o.status === "awaiting_address" && <div className="card pad muted">Waiting for the winner to add their shipping address.</div>}
      {isSeller && o.status === "awaiting_payment" && <div className="card pad muted">Waiting for the winner to pay. Don&apos;t ship until this order shows as paid.</div>}
      {isSeller && o.status === "paid" && (
        <div className="card pad"><h2 style={{ marginTop: 0 }}>Ship the item</h2><ShipForm orderId={o.id} /></div>
      )}
      {isSeller && o.status === "shipped" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Shipped</h2>
          <p style={{ margin: 0 }}>
            Sent with <strong>{o.carrier}</strong>
            {o.tracking_number && <> · Tracking number <strong>{o.tracking_number}</strong></>}. Waiting for the winner to confirm it arrived.
          </p>
        </div>
      )}
      {me.isAdmin && o.status === "awaiting_payment" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Admin: record an offline payment</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Only if the winner paid into Bidwell&apos;s own account. The money is then held in escrow.</p>
          <AdminMarkPaidForm orderId={o.id} />
        </div>
      )}

      {/* Disputes */}
      {disputes.map((x) => (
        <div key={x.id} className={`card pad dispute ${x.status === "open" ? "open" : ""}`}>
          <div className="spread">
            <h2 style={{ margin: 0 }}>Reported problem: {x.reason}</h2>
            <span className={`pill ${x.status === "open" ? "err" : "ok"}`}>
              {x.status === "open" ? "Under review" : x.status === "refunded" ? "Refunded" : x.status === "released" ? "Seller paid" : "Order continued"}
            </span>
          </div>
          <div className="small muted">Reported {dateTime(x.created_at)}</div>
          <p className="pre">{x.details}</p>
          {x.seller_response && (
            <div className="quote"><div className="small muted">Seller&apos;s response</div><p className="pre">{x.seller_response}</p></div>
          )}
          {x.admin_note && (
            <div className="quote"><div className="small muted">Bidwell&apos;s decision · {x.resolved_at && dateTime(x.resolved_at)}</div><p className="pre">{x.admin_note}</p></div>
          )}
          {x.status === "open" && isSeller && !x.seller_response && <RespondForm orderId={o.id} disputeId={x.id} />}
          {x.status === "open" && isBuyer && <p className="small muted">Bidwell will look at both sides and decide. The money stays frozen until then.</p>}
          {x.status === "open" && me.isAdmin && (
            <div style={{ marginTop: 12 }}>
              <ResolveForm orderId={o.id} disputeId={x.id} canResume />
            </div>
          )}
        </div>
      ))}

      {isBuyer && canDispute(o) && (
        <details className="card pad">
          <summary><strong>Something wrong with this order?</strong> <span className="muted small">Report a problem</span></summary>
          <div style={{ marginTop: 12 }}><DisputeForm orderId={o.id} reasons={DISPUTE_REASONS} /></div>
        </details>
      )}

      {o.status === "completed" && (
        <div className="card pad msg ok">
          Order complete. {isSeller || me.isAdmin
            ? <>Payout of {formatMoney(payout?.amount_cents ?? 0)}: {PAYOUT_LABEL[payout?.status ?? "pending"]}.
                {isSeller && payout?.status === "waiting_details" && <> <Link href="/account/payouts">Add your payout details</Link>.</>}</>
            : "Thanks for buying on Bidwell."}
        </div>
      )}
      {o.status === "refunded" && refund && (
        <div className="card pad msg ok">
          {formatMoney(refund.amount_cents)} {refund.status === "processed" ? "has been refunded" : "is being refunded"} to the winner.
        </div>
      )}
      {isSeller && !getPayoutAccount(d, me.id) && ["paid", "shipped", "delivered"].includes(o.status) && (
        <div className="msg err">Add your <Link href="/account/payouts">payout details</Link> so we can pay you when this order completes.</div>
      )}

      {o.ship_line1 && (isBuyer || isSeller || me.isAdmin) && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Shipping address</h2>
          <address style={{ fontStyle: "normal" }}>
            {o.ship_name}<br />
            {o.ship_line1}<br />
            {o.ship_line2 && <>{o.ship_line2}<br /></>}
            {o.ship_city}, {o.ship_region} {o.ship_postal}<br />
            {o.ship_country}<br />
            {o.ship_phone}
          </address>
          {isBuyer && (o.status === "awaiting_payment" || o.status === "paid") && (
            <details style={{ marginTop: 12 }}>
              <summary className="small muted" style={{ cursor: "pointer" }}>Change address</summary>
              <div style={{ marginTop: 12 }}><AddressForm order={o} /></div>
            </details>
          )}
        </div>
      )}

      <div className="card pad">
        <h2 style={{ marginTop: 0 }}>History</h2>
        <div className="table-wrap">
          <table className="list">
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{dateTime(e.created_at)}</td>
                  <td>{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EscrowPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    held: ["accent", "Held in escrow"],
    frozen: ["err", "Frozen: under review"],
    released: ["ok", "Released to seller"],
    refunded: ["ok", "Refunded"],
  };
  const m = map[status];
  return m ? <span className={`pill ${m[0]}`}>{m[1]}</span> : null;
}
