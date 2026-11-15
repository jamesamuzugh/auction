import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db.ts";
import { closeDueAuctions } from "./auctions.ts";
import { userForSession, type User } from "./users.ts";

export const SESSION_COOKIE = "sid";

/** The database, with any auctions whose time is up closed first. */
export function db() {
  const d = getDb();
  closeDueAuctions(d);
  return d;
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForSession(getDb(), token);
}

export async function requireUser(next = "/"): Promise<User> {
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  return u;
}

export type FormState = { error?: string; ok?: string } | undefined;
