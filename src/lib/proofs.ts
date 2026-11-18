import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { AuctionError } from "./auctions.ts";

/** Delivery-attempt photos are private evidence, so they live outside public/ and are served after a permission check. */
export function proofDir() {
  return process.env.PROOF_DIR ?? path.join(process.cwd(), "data", "proofs");
}

const TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic" };

export async function saveProofPhoto(file: FormDataEntryValue | null): Promise<string> {
  if (!(file instanceof File) || file.size === 0) throw new AuctionError("Take a photo at the address as proof of the visit.");
  const ext = TYPES[file.type];
  if (!ext) throw new AuctionError("The photo must be JPG, PNG, WebP or HEIC.");
  if (file.size > 8 * 1024 * 1024) throw new AuctionError("The photo must be 8 MB or smaller.");
  const name = `${crypto.randomUUID()}${ext}`;
  await fs.mkdir(proofDir(), { recursive: true });
  await fs.writeFile(path.join(proofDir(), name), Buffer.from(await file.arrayBuffer()));
  return name;
}

/** ID documents and selfies. Kept apart from delivery photos and shown only to the member and admins. */
export function kycDir() {
  return process.env.KYC_DIR ?? path.join(process.cwd(), "data", "kyc");
}

export async function saveKycPhoto(file: FormDataEntryValue | null, what: string): Promise<string> {
  if (!(file instanceof File) || file.size === 0) throw new AuctionError(`Add ${what}.`);
  const ext = TYPES[file.type];
  if (!ext) throw new AuctionError(`${what[0].toUpperCase()}${what.slice(1)} must be a JPG, PNG, WebP or HEIC photo.`);
  if (file.size > 8 * 1024 * 1024) throw new AuctionError("Each photo must be 8 MB or smaller.");
  const name = `${crypto.randomUUID()}${ext}`;
  await fs.mkdir(kycDir(), { recursive: true });
  await fs.writeFile(path.join(kycDir(), name), Buffer.from(await file.arrayBuffer()));
  return name;
}

export function proofContentType(name: string) {
  const ext = path.extname(name).toLowerCase();
  return Object.entries(TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
}
