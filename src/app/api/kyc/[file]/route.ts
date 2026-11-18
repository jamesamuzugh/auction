import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db.ts";
import { currentUser } from "@/lib/server.ts";
import { kycDir, proofContentType } from "@/lib/proofs.ts";

export const dynamic = "force-dynamic";

/** Serves an ID photo or selfie to the member who uploaded it or a Bidwell admin, and nobody else. */
export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|heic)$/.test(file)) return new NextResponse("not found", { status: 404 });
  const me = await currentUser();
  if (!me) return new NextResponse("sign in", { status: 401 });
  const row = getDb()
    .prepare(`SELECT user_id FROM id_checks WHERE front_path = ? OR back_path = ? OR selfie_path = ?`)
    .get(file, file, file) as { user_id: number } | undefined;
  if (!row || !(me.isAdmin || row.user_id === me.id)) return new NextResponse("not found", { status: 404 });
  const bytes = await fs.readFile(path.join(kycDir(), file));
  return new NextResponse(bytes, { headers: { "Content-Type": proofContentType(file), "Cache-Control": "private, no-store" } });
}
