import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "./db.ts";
import { closeDueAuctions } from "./auctions.ts";
import { isAdminEmail, processPayouts, processRefunds, runEscrowTimers } from "./escrow.ts";
import { getProvider, payoutProvider } from "./payments/index.ts";
import { userForSession, type User } from "./users.ts";

export const SESSION_COOKIE = "sid";

export type SessionUser = User & { isAdmin: boolean };

/** The database, with time-based steps (closing auctions, escrow releases) brought up to date. */
export function db() {
  const d = getDb();
  closeDueAuctions(d);
  runEscrowTimers(d);
  return d;
}

/** Sends queued payouts and refunds to the provider. Never throws: failures are recorded on the rows. */
export async function moveMoney() {
  const d = getDb();
  try {
    await processRefunds(d, getProvider);
    await processPayouts(d, payoutProvider());
  } catch (e) {
    console.error("moving money failed", e);
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const u = userForSession(getDb(), token);
  return u ? { ...u, isAdmin: isAdminEmail(u.email) } : null;
}

export async function requireUser(next = "/"): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser("/admin");
  if (!u.isAdmin) notFound();
  return u;
}

export type FormState = { error?: string; ok?: string } | undefined;
