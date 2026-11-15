import Link from "next/link";
import { notFound } from "next/navigation";
import { db, requireUser } from "@/lib/server.ts";
import { getOrder, orderEvents } from "@/lib/auctions.ts";
import { formatMoney } from "@/lib/money.ts";
import { ORDER_LABEL, ORDER_STEPS, dateTime } from "@/lib/format.ts";
import { AddressForm, DeliveredForm, MarkPaidForm, PayForm, ShipForm } from "@/components/OrderForms.tsx";
import { CURRENCY } from "@/lib/money.ts";
import { availableProviders } from "@/lib/payments/index.ts";

const PAYMENT_MSG: Record<string, { ok: boolean; text: string }> = {
  paid: { ok: true, text: "Payment received. The seller will ship your item soon." },
  already_paid: { ok: true, text: "This order is already paid." },
  failed: { ok: false, text: "The payment didn't go through. You can try again." },
  mismatch: { ok: false, text: "The amount paid didn't match the order. Contact support before trying again." },
  pending: { ok: false, text: "We haven't had confirmation of your payment yet. Refresh in a minute." },
};

export const dynamic = "force-dynamic";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { id } = await params;
  const paymentMsg = PAYMENT_MSG[(await searchParams).payment ?? ""];
  const providers = availableProviders(CURRENCY).map((p) => ({ id: p.id, label: p.label }));
  const me = await requireUser(`/orders/${id}`);
  const d = db();
  const o = getOrder(d, Number(id));
  // Only the buyer and seller can see an order.
  if (!o || (o.buyer_id !== me.id && o.seller_id !== me.id)) notFound();
  const isBuyer = o.buyer_id === me.id;
  const events = orderEvents(d, o.id);
  const stepIdx = ORDER_STEPS.findIndex((s) => s.key === o.status);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 18 }}>
      <div>
        <Link href={`/auctions/${o.auction_id}`} className="small muted">← Back to the auction</Link>
        <h1 style={{ marginTop: 8 }}>{o.auction_title}</h1>
        <div className="row muted">
          <span>Order #{o.id}</span>·<span>Won for <strong style={{ color: "var(--text)" }}>{formatMoney(o.amount_cents)}</strong></span>·
          <span>{isBuyer ? `Seller: ${o.seller_name}` : `Winner: ${o.buyer_name} (${o.buyer_email})`}</span>
        </div>
      </div>

      <div className="card pad">
        <div className="spread"><strong>{ORDER_LABEL[o.status]}</strong></div>
        <div className="steps">
          {ORDER_STEPS.map((s, i) => (
            <div key={s.key} className={`s ${i < stepIdx || o.status === "delivered" ? "done" : i === stepIdx ? "now" : ""}`}>
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {paymentMsg && <div className={`msg ${paymentMsg.ok ? "ok" : "err"}`}>{paymentMsg.text}</div>}

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
              Online payment isn&apos;t switched on yet. Pay {o.seller_name} directly; they&apos;ll confirm here, then ship your item.
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
      {!isBuyer && o.status === "awaiting_address" && (
        <div className="card pad muted">Waiting for the winner to add their shipping address.</div>
      )}
      {!isBuyer && o.status === "awaiting_payment" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Payment</h2>
          {providers.length > 0 ? (
            <p className="muted" style={{ margin: 0 }}>Waiting for the winner to pay online. You&apos;ll be able to ship once it clears.</p>
          ) : (
            <MarkPaidForm orderId={o.id} />
          )}
        </div>
      )}
      {!isBuyer && o.status === "paid" && (
        <div className="card pad"><h2 style={{ marginTop: 0 }}>Ship the item</h2><ShipForm orderId={o.id} /></div>
      )}
      {!isBuyer && o.status === "shipped" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Shipped</h2>
          <p style={{ margin: 0 }}>
            Sent with <strong>{o.carrier}</strong>
            {o.tracking_number && <> · Tracking number <strong>{o.tracking_number}</strong></>}. Waiting for the winner to
            confirm it arrived.
          </p>
        </div>
      )}
      {o.status === "delivered" &&<div className="card pad msg ok">Delivered. This order is complete.</div>}

      {o.ship_line1 && (
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
  );
}
