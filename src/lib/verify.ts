import type { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { tx } from "./db.ts";
import { AuctionError } from "./auctions.ts";
import { normalizePhone } from "./sms.ts";

/**
 * Verification for buyers and sellers, in two steps:
 * 1. Phone: we text a 6-digit code. One verified phone per account, one account per phone.
 * 2. ID: a photo of a Ghana Card, passport, driver's licence or voter ID, plus a selfie
 *    holding it. A Bidwell admin compares them and approves or rejects. One ID number can
 *    belong to only one account.
 * Both steps are needed before someone can bid or list an item.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const RESEND_AFTER_MS = 60_000;
export const MAX_SENDS_PER_HOUR = 5;
export const MAX_CODE_ATTEMPTS = 5;

export const DOC_TYPES = [
  { value: "ghana_card", label: "Ghana Card", needsBack: true },
  { value: "passport", label: "Passport", needsBack: false },
  { value: "drivers_licence", label: "Driver's licence", needsBack: true },
  { value: "voter_id", label: "Voter ID", needsBack: true },
] as const;
export type DocType = (typeof DOC_TYPES)[number]["value"];

export type Verification = {
  phone: string | null;
  phoneVerified: boolean;
  idStatus: "none" | "pending" | "verified" | "rejected";
  idReason: string | null;
  verified: boolean;
};

const hash = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

export function verificationFor(db: DatabaseSync, userId: number): Verification {
  const u = db.prepare(`SELECT phone, phone_verified_at, id_status FROM users WHERE id = ?`).get(userId) as
    | { phone: string | null; phone_verified_at: number | null; id_status: Verification["idStatus"] }
    | undefined;
  if (!u) throw new AuctionError("Account not found.");
  const last = db
    .prepare(`SELECT reason FROM id_checks WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(userId) as { reason: string | null } | undefined;
  const phoneVerified = u.phone_verified_at != null;
  return {
    phone: u.phone,
    phoneVerified,
    idStatus: u.id_status,
    idReason: u.id_status === "rejected" ? (last?.reason ?? null) : null,
    verified: phoneVerified && u.id_status === "verified",
  };
}

/** Throws a friendly error unless the user has finished both steps. `doing` completes "Verify your account to …". */
export function assertVerified(db: DatabaseSync, userId: number, doing: string) {
  const v = verificationFor(db, userId);
  if (v.verified) return;
  const step = !v.phoneVerified ? "confirm your phone number" : v.idStatus === "pending" ? "wait for your ID check" : "verify your ID";
  throw new AuctionError(`Verify your account to ${doing}: ${step} on the Verify page.`);
}

/** Creates a code for the phone and returns it for sending. Enforces resend and hourly limits. */
export function startPhoneCheck(db: DatabaseSync, userId: number, phoneInput: string, now = Date.now()): { phone: string; code: string } {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new AuctionError("Enter a valid phone number, for example 024 123 4567.");
  const taken = db.prepare(`SELECT id FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id <> ?`).get(phone, userId);
  if (taken) throw new AuctionError("That number is already verified on another Bidwell account.");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  tx(db, () => {
    const prev = db.prepare(`SELECT * FROM phone_codes WHERE user_id = ?`).get(userId) as
      | { sent_at: number; window_start: number; window_sends: number }
      | undefined;
    if (prev && now - prev.sent_at < RESEND_AFTER_MS) {
      throw new AuctionError(`Wait ${Math.ceil((RESEND_AFTER_MS - (now - prev.sent_at)) / 1000)} seconds before asking for another code.`);
    }
    const fresh = !prev || now - prev.window_start >= 3_600_000;
    const sends = fresh ? 1 : prev.window_sends + 1;
    if (sends > MAX_SENDS_PER_HOUR) throw new AuctionError("Too many codes requested. Try again in an hour.");
    db.prepare(
      `INSERT INTO phone_codes (user_id, phone, code_hash, attempts, expires_at, sent_at, window_start, window_sends)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET phone = excluded.phone, code_hash = excluded.code_hash, attempts = 0,
         expires_at = excluded.expires_at, sent_at = excluded.sent_at, window_start = excluded.window_start, window_sends = excluded.window_sends`
    ).run(userId, phone, hash(code), now + CODE_TTL_MS, now, fresh ? now : prev!.window_start, sends);
  });
  return { phone, code };
}

export function confirmPhoneCode(db: DatabaseSync, userId: number, codeInput: string, now = Date.now()) {
  const code = codeInput.replace(/\s/g, "");
  return tx(db, () => {
    const p = db.prepare(`SELECT * FROM phone_codes WHERE user_id = ?`).get(userId) as
      | { phone: string; code_hash: string; attempts: number; expires_at: number }
      | undefined;
    if (!p) throw new AuctionError("Ask for a code first.");
    if (p.expires_at <= now) throw new AuctionError("That code has expired. Ask for a new one.");
    if (p.attempts >= MAX_CODE_ATTEMPTS) throw new AuctionError("Too many wrong codes. Ask for a new one.");
    const ok = /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(hash(code)), Buffer.from(p.code_hash));
    if (!ok) {
      db.prepare(`UPDATE phone_codes SET attempts = attempts + 1 WHERE user_id = ?`).run(userId);
      const left = MAX_CODE_ATTEMPTS - p.attempts - 1;
      // Returned rather than thrown so the attempt count above is committed.
      return { ok: false as const, error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Ask for a new one." };
    }
    const taken = db.prepare(`SELECT id FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id <> ?`).get(p.phone, userId);
    if (taken) throw new AuctionError("That number is already verified on another Bidwell account.");
    db.prepare(`UPDATE users SET phone = ?, phone_verified_at = ? WHERE id = ?`).run(p.phone, now, userId);
    db.prepare(`DELETE FROM phone_codes WHERE user_id = ?`).run(userId);
    return { ok: true as const, phone: p.phone };
  });
}

export type IdSubmission = {
  docType: string;
  docNumber: string;
  fullName: string;
  dateOfBirth: string;
  frontPath: string;
  backPath: string | null;
  selfiePath: string;
};

const cleanDocNumber = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

/** Checks the typed details before any photo is saved. */
export function validateIdDetails(db: DatabaseSync, userId: number, d: Pick<IdSubmission, "docType" | "docNumber" | "fullName" | "dateOfBirth">, now = Date.now()) {
  const doc = DOC_TYPES.find((t) => t.value === d.docType);
  if (!doc) throw new AuctionError("Choose the type of ID.");
  const num = cleanDocNumber(d.docNumber);
  if (num.length < 5 || num.length > 30) throw new AuctionError("Enter the ID number exactly as it appears on the document.");
  if (doc.value === "ghana_card" && !/^GHA-?\d{9}-?\d$/.test(num)) throw new AuctionError("A Ghana Card number looks like GHA-123456789-0.");
  if (d.fullName.trim().length < 3) throw new AuctionError("Enter your full name as it appears on the ID.");
  const dob = Date.parse(d.dateOfBirth);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dateOfBirth) || Number.isNaN(dob)) throw new AuctionError("Enter your date of birth.");
  if (now - dob < 18 * 365.25 * 86_400_000) throw new AuctionError("You must be 18 or older to buy or sell on Bidwell.");
  const v = verificationFor(db, userId);
  if (!v.phoneVerified) throw new AuctionError("Confirm your phone number first.");
  if (v.idStatus === "pending") throw new AuctionError("Your ID is already being checked.");
  if (v.idStatus === "verified") throw new AuctionError("Your ID is already verified.");
  const dup = db
    .prepare(`SELECT 1 FROM id_checks WHERE doc_number = ? AND user_id <> ? AND status IN ('pending','approved')`)
    .get(num, userId);
  if (dup) throw new AuctionError("That ID is already linked to another Bidwell account. Contact Bidwell if this is a mistake.");
  return { needsBack: doc.needsBack, docNumber: num };
}

export function submitIdCheck(db: DatabaseSync, userId: number, s: IdSubmission, now = Date.now()): number {
  const { docNumber } = validateIdDetails(db, userId, s, now);
  return tx(db, () => {
    const r = db
      .prepare(
        `INSERT INTO id_checks (user_id, doc_type, doc_number, full_name, date_of_birth, front_path, back_path, selfie_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, s.docType, docNumber, s.fullName.trim(), s.dateOfBirth, s.frontPath, s.backPath, s.selfiePath, now);
    db.prepare(`UPDATE users SET id_status = 'pending' WHERE id = ?`).run(userId);
    return Number(r.lastInsertRowid);
  });
}

export type IdCheck = {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  user_phone: string | null;
  doc_type: DocType;
  doc_number: string;
  full_name: string;
  date_of_birth: string;
  front_path: string;
  back_path: string | null;
  selfie_path: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  created_at: number;
  reviewed_at: number | null;
  /** Other accounts that used the same ID number before. */
  same_number_elsewhere: number;
};

const CHECK_SELECT = `
  SELECT c.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
    (SELECT COUNT(*) FROM id_checks x WHERE x.doc_number = c.doc_number AND x.user_id <> c.user_id) AS same_number_elsewhere
  FROM id_checks c JOIN users u ON u.id = c.user_id`;

export function pendingIdChecks(db: DatabaseSync): IdCheck[] {
  return db.prepare(`${CHECK_SELECT} WHERE c.status = 'pending' ORDER BY c.created_at`).all() as IdCheck[];
}

export function recentIdDecisions(db: DatabaseSync, limit = 20): IdCheck[] {
  return db.prepare(`${CHECK_SELECT} WHERE c.status <> 'pending' ORDER BY c.reviewed_at DESC LIMIT ?`).all(limit) as IdCheck[];
}

export function reviewIdCheck(db: DatabaseSync, checkId: number, adminId: number, approve: boolean, reason: string, now = Date.now()) {
  tx(db, () => {
    const c = db.prepare(`SELECT * FROM id_checks WHERE id = ?`).get(checkId) as { user_id: number; status: string; doc_number: string } | undefined;
    if (!c) throw new AuctionError("ID check not found.");
    if (c.status !== "pending") throw new AuctionError("This ID check has already been decided.");
    if (!approve && reason.trim().length < 5) throw new AuctionError("Tell the member why, so they can fix it and try again.");
    if (approve) {
      const dup = db.prepare(`SELECT 1 FROM id_checks WHERE doc_number = ? AND user_id <> ? AND status = 'approved'`).get(c.doc_number, c.user_id);
      if (dup) throw new AuctionError("Another account is already verified with this ID number. Reject this one.");
    }
    db.prepare(`UPDATE id_checks SET status = ?, reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`).run(
      approve ? "approved" : "rejected",
      reason.trim() || null,
      adminId,
      now,
      checkId
    );
    db.prepare(`UPDATE users SET id_status = ? WHERE id = ?`).run(approve ? "verified" : "rejected", c.user_id);
  });
}

/** Marks a user fully verified without the checks. For the seed script and tests only. */
export function markVerifiedForTesting(db: DatabaseSync, userId: number, phone: string) {
  db.prepare(`UPDATE users SET phone = ?, phone_verified_at = ?, id_status = 'verified' WHERE id = ?`).run(phone, Date.now(), userId);
}
