import type { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { AuctionError } from "./auctions.ts";

export type User = { id: number; email: string; name: string; role?: "member" | "courier"; company?: string | null };

const SESSION_DAYS = 30;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

export function registerUser(db: DatabaseSync, email: string, name: string, password: string): User {
  email = email.trim().toLowerCase();
  name = name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuctionError("Enter a valid email address.");
  if (!name) throw new AuctionError("Enter your name.");
  if (password.length < 8) throw new AuctionError("Password must be at least 8 characters.");
  const exists = db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email);
  if (exists) throw new AuctionError("An account with that email already exists.");
  const r = db
    .prepare(`INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)`)
    .run(email, name, hashPassword(password), Date.now());
  return { id: Number(r.lastInsertRowid), email, name };
}

export function authenticate(db: DatabaseSync, email: string, password: string): User {
  const row = db
    .prepare(`SELECT id, email, name, password_hash FROM users WHERE email = ?`)
    .get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) throw new AuctionError("Wrong email or password.");
  return { id: row.id, email: row.email, name: row.name };
}

export function createSession(db: DatabaseSync, userId: number): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expires.getTime());
  return { token, expires };
}

export function userForSession(db: DatabaseSync, token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.company FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, Date.now()) as User | undefined;
  return row ?? null;
}

export function deleteSession(db: DatabaseSync, token: string) {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}
