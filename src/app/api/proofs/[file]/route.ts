import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db.ts";
import { currentUser } from "@/lib/server.ts";
import { proofContentType, proofDir } from "@/lib/proofs.ts";

export const dynamic = "force-dynamic";

/** Serves a delivery-attempt photo to the buyer, seller, assigned partner or an admin only. */
export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|heic)$/.test(file)) return new NextResponse("not found", { status: 404 });
  const me = await currentUser();
  if (!me) return new NextResponse("sign in", { status: 401 });
  const row = getDb()
    .prepare(
      `SELECT o.buyer_id, o.seller_id, o.courier_id FROM delivery_attempts d JOIN orders o ON o.id = d.order_id WHERE d.photo_path = ?`
    )
    .get(file) as { buyer_id: number; seller_id: number; courier_id: number } | undefined;
  if (!row || !(me.isAdmin || [row.buyer_id, row.seller_id, row.courier_id].includes(me.id))) {
    return new NextResponse("not found", { status: 404 });
  }
  const bytes = await fs.readFile(path.join(proofDir(), file));
  return new NextResponse(bytes, { headers: { "Content-Type": proofContentType(file), "Cache-Control": "private, max-age=3600" } });
}
