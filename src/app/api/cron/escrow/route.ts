import { NextResponse } from "next/server";
import { getDb } from "@/lib/db.ts";
import { closeDueAuctions } from "@/lib/auctions.ts";
import { runEscrowTimers } from "@/lib/escrow.ts";
import { moveMoney } from "@/lib/server.ts";

export const dynamic = "force-dynamic";

/**
 * Call every few minutes from a scheduler (cron, Render/Railway cron job, uptime pinger):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/escrow
 * Pages also run the timers on each visit, but this makes sure releases and payouts happen
 * even when nobody is browsing.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const d = getDb();
  const closed = closeDueAuctions(d);
  const timers = runEscrowTimers(d);
  await moveMoney();
  return NextResponse.json({ ok: true, closed, ...timers });
}
