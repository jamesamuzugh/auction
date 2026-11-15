import Link from "next/link";
import { db, moveMoney, requireAdmin } from "@/lib/server.ts";
import { formatMoney } from "@/lib/money.ts";
import { ORDER_LABEL, dateTime } from "@/lib/format.ts";
import {
  adminAwaitingPayment,
  adminDisputes,
  adminHeldOrders,
  adminOverview,
  adminPayouts,
  adminRefunds,
  feePercent,
} from "@/lib/escrow.ts";
import { payoutProvider } from "@/lib/payments/index.ts";
import { AdminMarkPaidForm } from "@/components/OrderForms.tsx";
import AdminButton from "@/components/AdminButton.tsx";
import { AddPartnerForm, RemovePartnerButton } from "@/components/PartnerForms.tsx";
import { listDeliveryPartners } from "@/lib/auctions.ts";
import Countdown from "@/components/Countdown.tsx";

export const dynamic = "force-dynamic";

const PILL: Record<string, string> = {
  failed: "err", waiting_details: "err", manual: "err", pending: "accent", processing: "accent", paid: "ok", processed: "ok",
};
const WORD: Record<string, string> = {
  failed: "Failed", waiting_details: "No payout details", manual: "Refund by hand", pending: "Queued",
  processing: "Processing", paid: "Paid", processed: "Refunded",
};

export default async function Admin() {
  await requireAdmin();
  const d = db();
  await moveMoney();
  const ov = adminOverview(d);
  const open = adminDisputes(d, "open");
  const closed = adminDisputes(d, "closed").slice(0, 20);
  const held = adminHeldOrders(d);
  const unpaid = adminAwaitingPayment(d);
  const payouts = adminPayouts(d);
  const refunds = adminRefunds(d);
  const provider = payoutProvider();
  const partners = listDeliveryPartners(d);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Bidwell admin</h1>
        <AdminButton op="run">Run releases and payouts now</AdminButton>
      </div>
      <div className="stats">
        <div className="card"><span className="small muted">Held in escrow</span><span className="v">{formatMoney(ov.heldCents)}</span></div>
        <div className="card"><span className="small muted">Frozen by reports</span><span className="v">{formatMoney(ov.frozenCents)}</span></div>
        <div className="card"><span className="small muted">Owed to sellers</span><span className="v">{formatMoney(ov.owedCents)}</span></div>
        <div className="card"><span className="small muted">Fees earned ({feePercent()}%)</span><span className="v">{formatMoney(ov.feesCents)}</span></div>
        <div className="card"><span className="small muted">Delivery fees due to partners</span><span className="v">{formatMoney(ov.deliveryCents)}</span></div>
      </div>
      {!provider && <div className="msg err">No payout provider is connected, so released funds queue up until Paystack keys are set.</div>}

      <section>
        <h2>Reported problems {open.length > 0 && <span className="pill err">{open.length} open</span>}</h2>
        <div className="card table-wrap">
          {open.length === 0 ? <div className="empty-state">No open reports.</div> : (
            <table className="list">
              <thead><tr><th>Order</th><th>Problem</th><th>Amount</th><th>Seller replied</th><th>Opened</th><th></th></tr></thead>
              <tbody>
                {open.map((x) => (
                  <tr key={x.id}>
                    <td>{x.auction_title}<div className="small muted">{x.buyer_name} bought from {x.seller_name}</div></td>
                    <td>{x.reason}</td>
                    <td>{formatMoney(x.amount_cents)}</td>
                    <td>{x.seller_response ? "Yes" : <span className="muted">Not yet</span>}</td>
                    <td className="small">{dateTime(x.created_at)}</td>
                    <td><Link className="btn" href={`/orders/${x.order_id}`}>Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2>Waiting for payment</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Record a payment here only if the winner paid into Bidwell&apos;s account outside the site.</p>
        <div className="card table-wrap">
          {unpaid.length === 0 ? <div className="empty-state">Nothing waiting.</div> : (
            <table className="list">
              <thead><tr><th>Order</th><th>Winner</th><th>Amount</th><th>Record offline payment</th></tr></thead>
              <tbody>
                {unpaid.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/orders/${o.id}`}>{o.auction_title}</Link></td>
                    <td>{o.buyer_name}<div className="small muted">{o.buyer_email}</div></td>
                    <td>{formatMoney(o.amount_cents)}</td>
                    <td style={{ minWidth: 260 }}><AdminMarkPaidForm orderId={o.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2>Held in escrow</h2>
        <div className="card table-wrap">
          {held.length === 0 ? <div className="empty-state">No money held right now.</div> : (
            <table className="list">
              <thead><tr><th>Order</th><th>Amount</th><th>Stage</th><th>Releases</th></tr></thead>
              <tbody>
                {held.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/orders/${o.id}`}>{o.auction_title}</Link><div className="small muted">{o.buyer_name} → {o.seller_name}</div></td>
                    <td>{formatMoney(o.amount_cents)}</td>
                    <td className="small">{ORDER_LABEL[o.status]}</td>
                    <td className="small">{o.escrow_status === "frozen" ? <span className="pill err">Frozen</span> : o.release_at ? <Countdown endsAt={o.release_at} /> : <span className="muted">After delivery</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2>Payouts to sellers</h2>
        <div className="card table-wrap">
          {payouts.length === 0 ? <div className="empty-state">No payouts yet.</div> : (
            <table className="list">
              <thead><tr><th>Seller</th><th>Order</th><th>Paid</th><th>Fee</th><th>Delivery</th><th>Payout</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.seller_name}</td>
                    <td><Link href={`/orders/${p.order_id}`}>{p.auction_title}</Link></td>
                    <td>{formatMoney(p.gross_cents)}</td>
                    <td>{formatMoney(p.fee_cents)}</td>
                    <td>{formatMoney(p.delivery_fee_cents)}</td>
                    <td><strong>{formatMoney(p.amount_cents)}</strong></td>
                    <td><span className={`pill ${PILL[p.status]}`}>{WORD[p.status]}</span>{p.failure_reason && <div className="small muted">{p.failure_reason}</div>}</td>
                    <td>{p.status === "failed" && <AdminButton op="retry_payout" id={p.id}>Retry</AdminButton>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2>Refunds to buyers</h2>
        <div className="card table-wrap">
          {refunds.length === 0 ? <div className="empty-state">No refunds.</div> : (
            <table className="list">
              <thead><tr><th>Buyer</th><th>Order</th><th>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id}>
                    <td>{r.buyer_name}</td>
                    <td><Link href={`/orders/${r.order_id}`}>{r.auction_title}</Link></td>
                    <td>{formatMoney(r.amount_cents)}</td>
                    <td><span className={`pill ${PILL[r.status]}`}>{WORD[r.status]}</span>{r.failure_reason && <div className="small muted">{r.failure_reason}</div>}</td>
                    <td className="row">
                      {r.status === "failed" && <AdminButton op="retry_refund" id={r.id}>Retry</AdminButton>}
                      {["failed", "manual"].includes(r.status) && <AdminButton op="refund_done" id={r.id}>Mark refunded by hand</AdminButton>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2>Delivery partners</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Riders sign up for a normal account first, then you add them here. They get a Deliveries page to confirm handovers.
        </p>
        <div className="card pad" style={{ display: "grid", gap: 12 }}>
          {partners.length > 0 && (
            <div className="table-wrap">
              <table className="list">
                <tbody>
                  {partners.map((p) => (
                    <tr key={p.id}><td><strong>{p.company}</strong></td><td>{p.name}</td><td className="muted">{p.email}</td><td><RemovePartnerButton id={p.id} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AddPartnerForm />
        </div>
      </section>

      {closed.length > 0 && (
        <section>
          <h2>Recently resolved reports</h2>
          <div className="card table-wrap">
            <table className="list">
              <thead><tr><th>Order</th><th>Problem</th><th>Decision</th><th>Resolved</th></tr></thead>
              <tbody>
                {closed.map((x) => (
                  <tr key={x.id}>
                    <td><Link href={`/orders/${x.order_id}`}>{x.auction_title}</Link></td>
                    <td>{x.reason}</td>
                    <td>{x.status === "refunded" ? "Refunded winner" : x.status === "released" ? "Paid seller" : "Order continued"}<div className="small muted">{x.admin_note}</div></td>
                    <td className="small">{x.resolved_at && dateTime(x.resolved_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
