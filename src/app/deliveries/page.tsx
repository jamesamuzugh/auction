import { notFound } from "next/navigation";
import { db, requireUser } from "@/lib/server.ts";
import { deliveriesForPartner, deliveryAttempts, MAX_CODE_ATTEMPTS } from "@/lib/auctions.ts";
import { ORDER_LABEL, dateTime } from "@/lib/format.ts";
import DeliverForm, { FailedAttemptForm } from "@/components/DeliverForm.tsx";

export const dynamic = "force-dynamic";

/** The delivery partner's job list: where to go, and the form to confirm each handover. */
export default async function Deliveries() {
  const me = await requireUser("/deliveries");
  if (me.role !== "courier") notFound();
  const d = db();
  const all = deliveriesForPartner(d, me.id);
  const open = all.filter((o) => o.status === "shipped");
  const returning = all.filter((o) => o.status === "returning");
  const done = all.filter((o) => o.status !== "shipped" && o.status !== "returning");
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 18 }}>
      <div>
        <h1>Deliveries</h1>
        <p className="muted" style={{ margin: 0 }}>
          {me.company ?? me.name} · Confirm each handover with the winner&apos;s 6-digit delivery code or their signature. The seller
          is paid only after this.
        </p>
      </div>
      {returning.map((o) => (
        <div key={o.id} className="card pad dispute open" style={{ display: "grid", gap: 12 }}>
          <div className="spread">
            <h2 style={{ margin: 0 }}>Return to seller: order #{o.id}, {o.auction_title}</h2>
            <span className="pill err">3 failed attempts</span>
          </div>
          <div>Take it back to <strong>{o.seller_name}</strong>. Ask them for their 6-digit return code, or for their signature.</div>
          <DeliverForm orderId={o.id} codeLocked={o.delivery_code_attempts >= MAX_CODE_ATTEMPTS} mode="return" />
        </div>
      ))}
      {open.length === 0 && returning.length === 0 && <div className="card empty-state">No deliveries waiting.</div>}
      {open.map((o) => (
        <div key={o.id} className="card pad" style={{ display: "grid", gap: 12 }}>
          <div className="spread">
            <h2 style={{ margin: 0 }}>Order #{o.id}: {o.auction_title}</h2>
            {o.tracking_number && <span className="pill">{o.tracking_number}</span>}
          </div>
          <address style={{ fontStyle: "normal" }}>
            <strong>{o.ship_name}</strong> · {o.ship_phone}<br />
            {o.ship_line1}{o.ship_line2 && <>, {o.ship_line2}</>}<br />
            {o.ship_city}, {o.ship_region} {o.ship_postal} · {o.ship_country}
          </address>
          <div className="small muted">Picked up from {o.seller_name} · {o.shipped_at && dateTime(o.shipped_at)}</div>
          {(() => {
            const tries = deliveryAttempts(d, o.id);
            return (
              <>
                {tries.length > 0 && (
                  <div className="small">
                    {tries.map((t) => (
                      <div key={t.id} className="muted">Attempt {t.attempt_no}: {dateTime(t.created_at)} · {t.note}</div>
                    ))}
                  </div>
                )}
                <DeliverForm orderId={o.id} codeLocked={o.delivery_code_attempts >= MAX_CODE_ATTEMPTS} />
                <details>
                  <summary className="small"><strong>Couldn&apos;t deliver?</strong> Record a failed attempt</summary>
                  <div style={{ marginTop: 12 }}><FailedAttemptForm orderId={o.id} attempt={tries.length + 1} /></div>
                </details>
              </>
            );
          })()}
        </div>
      ))}
      {done.length > 0 && (
        <div className="card table-wrap">
          <table className="list">
            <thead><tr><th>Delivered</th><th>Order</th><th>Proof</th><th>Status</th></tr></thead>
            <tbody>
              {done.map((o) => (
                <tr key={o.id}>
                  <td className="small">{o.delivered_at ? dateTime(o.delivered_at) : "—"}</td>
                  <td>#{o.id} {o.auction_title}</td>
                  <td className="small">{o.delivery_method === "code" ? "Code" : o.delivery_method === "signature" ? "Signature" : o.delivery_method === "admin" ? "Bidwell" : "—"}{o.delivery_recipient && ` · ${o.delivery_recipient}`}</td>
                  <td className="small">{ORDER_LABEL[o.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
