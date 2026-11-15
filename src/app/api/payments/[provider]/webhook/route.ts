import { NextResponse } from "next/server";
import { db } from "@/lib/server.ts";
import { applyPaymentResult, getPayment } from "@/lib/auctions.ts";
import { getProvider } from "@/lib/payments/index.ts";

export const dynamic = "force-dynamic";

/**
 * Server-to-server notice from the provider. This catches payments where the payer closed the
 * tab before being sent back. Point Paystack's webhook URL at /api/payments/paystack/webhook.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = getProvider((await params).provider);
  if (!provider) return new NextResponse("unknown provider", { status: 404 });
  const raw = await req.text();
  const evt = provider.parseWebhook(raw, req.headers);
  if (!evt) return new NextResponse("bad signature", { status: 401 });
  const d = db();
  if (!getPayment(d, evt.reference)) return NextResponse.json({ ok: true, ignored: true });
  applyPaymentResult(d, evt.reference, await provider.verify(evt.reference), provider.name);
  return NextResponse.json({ ok: true });
}
