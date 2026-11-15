import { notFound } from "next/navigation";
import { db } from "@/lib/server.ts";
import { getPayment } from "@/lib/auctions.ts";
import { formatMoney } from "@/lib/money.ts";
import { demoPayAction } from "@/app/actions.ts";

export const dynamic = "force-dynamic";

export default async function DemoPay({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  if (process.env.PAYMENTS_DEMO !== "1") notFound();
  const p = getPayment(db(), (await searchParams).reference ?? "");
  if (!p) notFound();
  return (
    <div className="card pad" style={{ maxWidth: 420, margin: "24px auto", display: "grid", gap: 12 }}>
      <span className="pill accent" style={{ justifySelf: "start" }}>Test mode</span>
      <h1>Demo checkout</h1>
      <p className="muted" style={{ margin: 0 }}>
        This stands in for Paystack while no keys are set. No real money moves.
      </p>
      <div className="price" style={{ fontSize: 30 }}>{formatMoney(p.amount_cents)}</div>
      <form action={demoPayAction} className="row">
        <input type="hidden" name="reference" value={p.reference} />
        <button className="btn primary" name="result" value="ok">Pay now</button>
        <button className="btn" name="result" value="fail">Simulate a failed payment</button>
      </form>
    </div>
  );
}
