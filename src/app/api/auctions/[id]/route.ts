import { NextResponse } from "next/server";
import { db, currentUser } from "@/lib/server.ts";
import { getAuction, listBids } from "@/lib/auctions.ts";
import { snapshot } from "@/lib/snapshot.ts";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = db();
  const a = getAuction(d, Number(id));
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  const me = await currentUser();
  return NextResponse.json(snapshot(a, listBids(d, a.id, 20), me?.id ?? null));
}

