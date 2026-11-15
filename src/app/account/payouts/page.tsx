import Link from "next/link";
import { db, moveMoney, requireUser } from "@/lib/server.ts";
import { CURRENCY, formatMoney } from "@/lib/money.ts";
import { dateTime } from "@/lib/format.ts";
import { feePercent, getPayoutAccount, heldForSeller, payoutsForSeller } from "@/lib/escrow.ts";
import { payoutProvider } from "@/lib/payments/index.ts";
import { demo } from "@/lib/payments/demo.ts";
import PayoutForm from "@/components/PayoutForm.tsx";
import Countdown from "@/components/Countdown.tsx";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  waiting_details: ["err", "Needs your payout details"],
  pending: ["accent", "Queued"],
  processing: ["accent", "On its way"],
  paid: ["ok", "Paid"],
  failed: ["err", "Failed, we'll retry"],
};

export default async function Payouts() {
  const me = await requireUser("/account/payouts");
  const d = db();
  await moveMoney();
  const acct = getPayoutAccount(d, me.id);
  const provider = payoutProvider();
  let banks = await demo.payouts!.listBanks(CURRENCY);
  let sample = true;
  if (provider?.payouts && provider.id !== "demo") {
    try {
      banks = await provider.payouts.listBanks(CURRENCY);
      sample = false;
    } catch (e) {
      console.error("bank list failed", e);
    }
  }
  const held = heldForSeller(d, me.id);
  const payouts = payoutsForSeller(d, me.id);
  const paidTotal = payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount_cents, 0);
  const heldTotal = held.reduce((s, o) => s + o.amount_cents, 0);
  const fee = feePercent();

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 18 }}>
      <div>
        <Link href="/account" className="small muted">← My account</Link>
        <h1 style={{ marginTop: 8 }}>Payouts</h1>
        <p className="muted" style={{ margin: 0 }}>
          Bidwell holds each buyer&apos;s payment until they confirm delivery and 6 hours pass with no problem reported. Then we send it
          here, less our {fee}% fee (on the total the winner paid) and the delivery fee.
        </p>
      </div>

      <div className="stats">
        <div className="card"><span className="small muted">Held for you now</span><span className="v">{formatMoney(heldTotal)}</span></div>
        <div className="card"><span className="small muted">Paid to you so far</span><span className="v">{formatMoney(paidTotal)}</span></div>
      </div>

      <div className="card pad">
        <h2 style={{ marginTop: 0 }}>Where we pay you</h2>
        {acct && (
          <p className="small" style={{ marginTop: 0 }}>
            Currently: <strong>{acct.bank_name}</strong> · {acct.account_number} · {acct.account_name}
          </p>
        )}
        {sample && <p className="small muted" style={{ marginTop: 0 }}>Online payouts aren&apos;t connected yet, so this list is a sample.</p>}
        <PayoutForm banks={banks} current={acct ?? null} />
      </div>

      {held.length > 0 && (
        <div className="card table-wrap">
          <table className="list">
            <thead><tr><th>Held in escrow</th><th>Amount</th><th>Releases</th></tr></thead>
            <tbody>
              {held.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/orders/${o.id}`}>{o.auction_title}</Link></td>
                  <td>{formatMoney(o.amount_cents)}</td>
                  <td className="small">
                    {o.status === "disputed" ? <span className="pill err">Problem reported</span>
                      : o.release_at ? <>in <Countdown endsAt={o.release_at} /></>
                      : <span className="muted">After the buyer confirms delivery</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card table-wrap">
        {payouts.length === 0 ? (
          <div className="empty-state">No payouts yet.</div>
        ) : (
          <table className="list">
            <thead><tr><th>Payout</th><th>Paid by winner</th><th>Fee</th><th>Delivery</th><th>You get</th><th>Status</th></tr></thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/orders/${p.order_id}`}>{p.auction_title}</Link><div className="small muted">{dateTime(p.created_at)}</div></td>
                  <td>{formatMoney(p.gross_cents)}</td>
                  <td>{formatMoney(p.fee_cents)}</td>
                  <td>{formatMoney(p.delivery_fee_cents)}</td>
                  <td><strong>{formatMoney(p.amount_cents)}</strong></td>
                  <td><span className={`pill ${STATUS[p.status][0]}`}>{STATUS[p.status][1]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
