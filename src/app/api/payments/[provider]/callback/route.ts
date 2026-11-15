import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/server.ts";
import { applyPaymentResult, getPayment } from "@/lib/auctions.ts";
import { getProvider } from "@/lib/payments/index.ts";

export const dynamic = "force-dynamic";

/** Where the provider sends the payer back. We re-check the payment with the provider before trusting it. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const provider = getProvider((await params).provider);
  const reference = req.nextUrl.searchParams.get("reference") ?? req.nextUrl.searchParams.get("trxref") ?? "";
  const d = db();
  const p = getPayment(d, reference);
  if (!provider || !p || p.provider !== provider.id) return NextResponse.redirect(new URL("/account", req.url));
  let outcome = "pending";
  try {
    const r = applyPaymentResult(d, reference, await provider.verify(reference), provider.name);
    outcome = r.outcome;
  } catch (e) {
    console.error("payment verify failed", e);
  }
  return NextResponse.redirect(new URL(`/orders/${p.order_id}?payment=${outcome}`, req.url));
}
