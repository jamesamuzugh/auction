import Link from "next/link";
import { notFound } from "next/navigation";
import { db, moveMoney, requireUser } from "@/lib/server.ts";
import { deliveryAttempts, getOrder, listDeliveryPartners, MAX_DELIVERY_ATTEMPTS, orderEvents } from "@/lib/auctions.ts";
import { formatMoney, CURRENCY } from "@/lib/money.ts";
import { ORDER_LABEL, ORDER_STEPS, dateTime } from "@/lib/format.ts";
import {
  DISPUTE_REASONS,
  canDispute,
  disputesForOrder,
  failedDeliverySplit,
  feePercent,
  saleSplit,
  getPayoutAccount,
  getPayoutForOrder,
  getRefundForOrder,
} from "@/lib/escrow.ts";
import { availableProviders } from "@/lib/payments/index.ts";
import {
  AcceptForm,
  AddressForm,
  AdminDeliveryForm,
  AdminMarkPaidForm,
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
  const split = saleSplit(o);
  const failSplit = failedDeliverySplit(o);
  const attempts = deliveryAttempts(d, o.id);
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
          <strong>{formatMoney(o.total_cents)} is held by Bidwell</strong>
          {o.escrow_status === "frozen" ? (
            <p>Payment is frozen while Bidwell reviews the reported problem. Nobody can move it until a decision is made.</p>
          ) : releaseWindowOpen ? (
            <p>
              Delivered. The seller is paid automatically in <Countdown endsAt={o.release_at!} refreshOnEnd /> ({dateTime(o.release_at!)})
              unless the winner reports a problem first, or straight away if the winner accepts the item.
            </p>
          ) : isBuyer ? (
            <p>
              The seller doesn&apos;t get your money until our delivery partner confirms delivery. You then have 6 hours to check the
              item and accept it or report a problem.
            </p>
          ) : (
            <p>
              You&apos;ll be paid {formatMoney(split.seller)} (after the {formatMoney(split.fee)} Bidwell fee and{" "}
              {formatMoney(split.delivery)} delivery) once the delivery partner confirms delivery and the winner
              accepts the item, or 6 hours after delivery if they don&apos;t report a problem.
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
          <h2 style={{ marginTop: 0 }}>Next: pay {formatMoney(o.total_cents)}</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            {formatMoney(o.amount_cents)} winning bid + {formatMoney(o.delivery_fee_cents)} delivery. You pay Bidwell, and we hold it until
            you have your item.
          </p>
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
        <div className="card pad" style={{ display: "grid", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Your item is on its way</h2>
          <p style={{ margin: 0 }}>
            With <strong>{o.carrier}</strong>
            {o.tracking_number && <> · Tracking number <strong>{o.tracking_number}</strong></>}
          </p>
          <div className="small muted">Your delivery code</div>
          <div className="delivery-code">{o.delivery_code}</div>
          <p className="small muted" style={{ margin: 0 }}>
            Give this code to the delivery partner only when you have the parcel in your hands. If you can&apos;t, you can sign for it
            instead. Don&apos;t share it with anyone else.
          </p>
        </div>
      )}
      {isBuyer && o.status === "delivered" && o.escrow_status === "held" && (
        <div className="card pad" style={{ display: "grid", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Check your item</h2>
          <p style={{ margin: 0 }}>
            If it&apos;s in good condition and as described, accept it and the seller is paid now. If something is wrong, report a
            problem below before <strong>{dateTime(o.release_at!)}</strong>. If you do neither, the seller is paid then.
          </p>
          <AcceptForm orderId={o.id} />
        </div>
      )}
      {isSeller && o.status === "awaiting_address" && <div className="card pad muted">Waiting for the winner to add their shipping address.</div>}
      {isSeller && o.status === "awaiting_payment" && <div className="card pad muted">Waiting for the winner to pay. Don&apos;t ship until this order shows as paid.</div>}
      {isSeller && o.status === "paid" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Ship the item</h2>
          <ShipForm orderId={o.id} partners={listDeliveryPartners(d).map((p) => ({ id: p.id, label: p.company ? `${p.company} (${p.name})` : p.name }))} />
        </div>
      )}
      {isSeller && o.status === "shipped" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Shipped</h2>
          <p style={{ margin: 0 }}>
            Sent with <strong>{o.carrier}</strong>
            {o.tracking_number && <> · Tracking number <strong>{o.tracking_number}</strong></>}. Waiting for the delivery partner to
            confirm delivery.
          </p>
        </div>
      )}
      {me.isAdmin && o.status === "shipped" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Admin: confirm delivery by hand</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            Only when the partner can&apos;t confirm in the app but has proof. Code: <strong>{o.delivery_code}</strong>
            {o.delivery_code_attempts > 0 && <> · {o.delivery_code_attempts} wrong code attempts</>}
          </p>
          <AdminDeliveryForm orderId={o.id} />
        </div>
      )}
      {me.isAdmin && o.status === "awaiting_payment" && (
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>Admin: record an offline payment</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Only if the winner paid into Bidwell&apos;s own account. The money is then held in escrow.</p>
          <AdminMarkPaidForm orderId={o.id} />
        </div>
      )}

      {o.status === "returning" && (
        <div className="card pad dispute open">
          <h2 style={{ margin: 0 }}>Delivery failed {MAX_DELIVERY_ATTEMPTS} times</h2>
          {isBuyer && (
            <p>
              The item is going back to the seller at your cost. Once it&apos;s returned you&apos;ll be refunded{" "}
              <strong>{formatMoney(failSplit.refund)}</strong>: the {formatMoney(failSplit.total)} you paid, less the{" "}
              {formatMoney(failSplit.fee)} Bidwell fee, {formatMoney(failSplit.delivery)} delivery and {formatMoney(failSplit.returnFee)} return.
              If the partner never actually came, report a problem below.
            </p>
          )}
          {(isSeller || me.isAdmin) && (
            <>
              <p>{o.carrier} is bringing the item back. Give them this return code only when you have it in your hands:</p>
              <div className="delivery-code">{o.return_code}</div>
            </>
          )}
        </div>
      )}

      {attempts.length > 0 && (
        <div className="card pad" style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Failed delivery attempts ({attempts.length} of {MAX_DELIVERY_ATTEMPTS})</h2>
          {attempts.map((t) => (
            <div key={t.id} className="attempt">
              <a href={`/api/proofs/${t.photo_path}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/proofs/${t.photo_path}`} alt={`Photo from attempt ${t.attempt_no}`} />
              </a>
              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <strong>Attempt {t.attempt_no} · {dateTime(t.created_at)}</strong>
                <span>{t.note}</span>
                <span className="small muted">
                  {t.lat != null && t.lng != null ? (
                    <a href={`https://www.google.com/maps?q=${t.lat},${t.lng}`} target="_blank" rel="noreferrer">
                      Location {t.lat.toFixed(5)}, {t.lng.toFixed(5)}
                    </a>
                  ) : (
                    "No location shared by the phone"
                  )}
                  {t.accuracy_m != null && <> (within {Math.round(t.accuracy_m)} m)</>}
                </span>
              </div>
            </div>
          ))}
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

      {o.delivery_method && (
        <div className="card pad" style={{ display: "grid", gap: 6 }}>
          <h2 style={{ margin: 0 }}>Proof of delivery</h2>
          <div>
            {o.delivery_method === "code" && <>Delivery code given by <strong>{o.delivery_recipient}</strong></>}
            {o.delivery_method === "signature" && <>Signed for by <strong>{o.delivery_recipient}</strong></>}
            {o.delivery_method === "admin" && <>Confirmed by Bidwell: {o.delivery_recipient}</>}
            {o.delivered_at && <span className="muted"> · {dateTime(o.delivered_at)} · {o.carrier}</span>}
          </div>
          {o.delivery_signature && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={o.delivery_signature} alt={`Signature of ${o.delivery_recipient}`} className="sigimg" />
          )}
        </div>
      )}

      <div className="card pad">
        <h2 style={{ marginTop: 0 }}>Payment breakdown</h2>
        <table className="list">
          <tbody>
            <tr><td>Winning bid</td><td className="num">{formatMoney(o.amount_cents)}</td></tr>
            <tr><td>Delivery</td><td className="num">{formatMoney(o.delivery_fee_cents)}</td></tr>
            <tr><th>Total paid by the winner</th><th className="num">{formatMoney(o.total_cents)}</th></tr>
            {(isSeller || me.isAdmin) && !["returning", "returned", "refunded"].includes(o.status) && (
              <>
                <tr><td>Bidwell fee ({feePercent()}% of the total)</td><td className="num">−{formatMoney(split.fee)}</td></tr>
                <tr><td>Delivery, paid to the partner</td><td className="num">−{formatMoney(split.delivery)}</td></tr>
                <tr><th>Seller receives</th><th className="num">{formatMoney(split.seller)}</th></tr>
              </>
            )}
            {["returning", "returned"].includes(o.status) || (o.status === "refunded" && o.returned_at) ? (
              <>
                <tr><td>Bidwell fee ({feePercent()}% of the total)</td><td className="num">−{formatMoney(failSplit.fee)}</td></tr>
                <tr><td>Delivery</td><td className="num">−{formatMoney(failSplit.delivery)}</td></tr>
                <tr><td>Return to seller</td><td className="num">−{formatMoney(failSplit.returnFee)}</td></tr>
                <tr><th>Refunded to the winner</th><th className="num">{formatMoney(failSplit.refund)}</th></tr>
              </>
            ) : null}
          </tbody>
        </table>
      </div>

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
