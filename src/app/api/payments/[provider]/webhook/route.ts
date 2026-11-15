import { NextResponse } from "next/server";
import { db, moveMoney } from "@/lib/server.ts";
import { applyPaymentResult, getPayment } from "@/lib/auctions.ts";
import { applyRefundResult, applyTransferResult } from "@/lib/escrow.ts";
import { getProvider } from "@/lib/payments/index.ts";

export const dynamic = "force-dynamic";

/**
 * Server-to-server notices from the provider: completed charges (in case the payer closed the
 * tab before being sent back), and the outcome of payouts and refunds.
 * Point Paystack's webhook URL at /api/payments/paystack/webhook.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = getProvider((await params).provider);
  if (!provider) return new NextResponse("unknown provider", { status: 404 });
  const raw = await req.text();
  const evt = provider.parseWebhook(raw, req.headers);
  if (!evt) return new NextResponse("bad signature or ignored event", { status: 200 });
  const d = db();
  if (evt.kind === "charge") {
    if (getPayment(d, evt.reference)) applyPaymentResult(d, evt.reference, await provider.verify(evt.reference), provider.name);
  } else if (evt.kind === "transfer") {
    applyTransferResult(d, evt.reference, evt.status, undefined, evt.message);
  } else if (evt.kind === "refund") {
    applyRefundResult(d, evt.reference, evt.status);
  }
  await moveMoney();
  return NextResponse.json({ ok: true });
}
