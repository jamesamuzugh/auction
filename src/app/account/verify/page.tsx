import Link from "next/link";
import { getDb } from "@/lib/db.ts";
import { requireUser } from "@/lib/server.ts";
import { verificationFor } from "@/lib/verify.ts";
import { ConfirmCodeForm, IdForm, SendCodeForm } from "@/components/VerifyForms.tsx";

export const dynamic = "force-dynamic";

const safe = (n: string | undefined) => (n && n.startsWith("/") && !n.startsWith("//") ? n : null);

export default async function Verify({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const me = await requireUser("/account/verify");
  const next = safe((await searchParams).next);
  const d = getDb();
  const v = verificationFor(d, me.id);
  const pending = d
    .prepare(`SELECT phone FROM phone_codes WHERE user_id = ? AND expires_at > ?`)
    .get(me.id, Date.now()) as { phone: string } | undefined;

  const step = (n: number, title: string, done: boolean, state: string) => (
    <div className="spread">
      <h2 style={{ margin: 0 }}>{n}. {title}</h2>
      <span className={`pill ${done ? "ok" : state === "Rejected" ? "err" : "accent"}`}>{done ? "Done" : state}</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", display: "grid", gap: 18 }}>
      <div>
        <Link href="/account" className="small muted">← My account</Link>
        <h1 style={{ marginBottom: 6 }}>Verify your account</h1>
        <p className="muted" style={{ margin: 0 }}>
          Everyone who buys or sells on Bidwell confirms their phone number and has their ID checked once. It keeps out fake bids and
          fake sellers, and means a delivery partner always knows who they&apos;re handing a parcel to.
        </p>
      </div>

      {v.verified && (
        <div className="msg ok">
          Your account is verified. You can bid and sell.{" "}
          {next && <Link href={next}><strong>Carry on where you left off</strong></Link>}
        </div>
      )}

      <div className="card pad stack">
        {step(1, "Phone number", v.phoneVerified, pending ? "Code sent" : "To do")}
        {v.phoneVerified ? (
          <p style={{ margin: 0 }}>Confirmed: <strong>{v.phone}</strong></p>
        ) : (
          <>
            <SendCodeForm phone={pending?.phone ?? v.phone ?? ""} again={!!pending} />
            {pending && <ConfirmCodeForm phone={pending.phone} />}
          </>
        )}
      </div>

      <div className="card pad stack">
        {step(2, "ID check", v.idStatus === "verified", v.idStatus === "pending" ? "Being checked" : v.idStatus === "rejected" ? "Rejected" : "To do")}
        {v.idStatus === "verified" && <p style={{ margin: 0 }}>Your ID has been checked by Bidwell.</p>}
        {v.idStatus === "pending" && (
          <p style={{ margin: 0 }}>Thanks. Bidwell is checking your ID, usually within one working day. You&apos;ll be able to bid and sell as soon as it&apos;s approved.</p>
        )}
        {v.idStatus === "rejected" && (
          <div className="msg err">We couldn&apos;t approve your last ID check{v.idReason ? `: ${v.idReason}` : "."} Please send it again.</div>
        )}
        {(v.idStatus === "none" || v.idStatus === "rejected") &&
          (v.phoneVerified ? <IdForm name={me.name} /> : <p className="muted" style={{ margin: 0 }}>Confirm your phone number first.</p>)}
      </div>
    </div>
  );
}
