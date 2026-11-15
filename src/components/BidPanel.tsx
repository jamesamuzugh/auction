"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { bidAction } from "@/app/actions.ts";
import type { Snapshot } from "@/lib/snapshot.ts";
import { formatMoney } from "@/lib/money.ts";
import { dateTime } from "@/lib/format.ts";
import Countdown from "./Countdown.tsx";
import { Submit } from "./Form.tsx";

export default function BidPanel({
  initial,
  signedIn,
  isSeller,
  orderId,
}: {
  initial: Snapshot;
  signedIn: boolean;
  isSeller: boolean;
  orderId: number | null;
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [state, formAction] = useActionState(bidAction, undefined);
  const amountRef = useRef<HTMLInputElement>(null);

  // Poll for new bids while the auction is open.
  useEffect(() => {
    if (s.status !== "active") return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/auctions/${s.id}`, { cache: "no-store" });
        if (r.ok && !stop) {
          const next: Snapshot = await r.json();
          setS(next);
          if (next.status !== "active") router.refresh();
        }
      } catch {}
    };
    const t = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [s.id, s.status, router]);

  useEffect(() => setS(initial), [initial]);

  useEffect(() => {
    if (state?.ok && amountRef.current) amountRef.current.value = "";
  }, [state]);

  const open = s.status === "active" && s.ends_at > Date.now() - 1000;
  const price = s.current_bid_cents ?? s.starting_bid_cents;

  return (
    <div className="card pad bidpanel">
      <div className="spread">
        <div className="stat">
          <span className="k">{s.bid_count ? "Current bid" : "Starting bid"}</span>
          <span className="price" style={{ fontSize: 30 }}>{formatMoney(price)}</span>
        </div>
        <div className="stat" style={{ textAlign: "right" }}>
          <span className="k">{open ? "Time left" : "Status"}</span>
          {open ? <Countdown endsAt={s.ends_at} refreshOnEnd /> : <strong>{s.status === "cancelled" ? "Cancelled" : "Closed"}</strong>}
        </div>
      </div>
      <div className="small muted">
        {s.bid_count} bid{s.bid_count === 1 ? "" : "s"} · Minimum increment {formatMoney(s.min_increment_cents)} · Ends{" "}
        {dateTime(s.ends_at)}
      </div>

      {open && s.leading && <div className="msg ok">You're the highest bidder.</div>}

      {open && !isSeller && signedIn && !s.leading && (
        <form action={formAction} className="stack" key={s.min_next_cents}>
          {state?.error && <div className="msg err" role="alert">{state.error}</div>}
          
          <label>
            Your bid
            <span className="hint">Enter {formatMoney(s.min_next_cents)} or more</span>
            <input
              ref={amountRef}
              name="amount"
              inputMode="decimal"
              placeholder={(s.min_next_cents / 100).toFixed(2)}
              required
            />
          </label>
          <input type="hidden" name="auction_id" value={s.id} />
          <div className="row">
            <Submit>Place bid</Submit>
            {(
              <button
                type="button"
                className="btn"
                onClick={() => amountRef.current && (amountRef.current.value = (s.min_next_cents / 100).toFixed(2))}
              >
                Use {formatMoney(s.min_next_cents)}
              </button>
            )}
          </div>
        </form>
      )}
      {open && !signedIn && (
        <Link className="btn primary" href={`/login?next=/auctions/${s.id}`}>
          Sign in to bid
        </Link>
      )}
      {open && isSeller && <div className="msg" style={{ background: "var(--bg)" }}>This is your listing.</div>}

      {!open && s.status === "ended" && (
        <div className="stack" style={{ display: "grid", gap: 10 }}>
          {s.bid_count === 0 ? (
            <div className="muted">This auction ended with no bids.</div>
          ) : s.winner_is_me ? (
            <>
              <div className="msg ok">You won this auction for {formatMoney(price)}.</div>
              {orderId && (
                <Link className="btn primary" href={`/orders/${orderId}`}>
                  Add shipping details
                </Link>
              )}
            </>
          ) : isSeller ? (
            <>
              <div className="msg ok">Sold for {formatMoney(price)}.</div>
              {orderId && (
                <Link className="btn primary" href={`/orders/${orderId}`}>
                  Manage order and shipping
                </Link>
              )}
            </>
          ) : (
            <div className="muted">Sold for {formatMoney(price)}.</div>
          )}
        </div>
      )}

      <div>
        <h2 style={{ margin: "8px 0 6px", fontSize: 16 }}>Bid history</h2>
        {s.bids.length === 0 ? (
          <div className="small muted">No bids yet. Be the first.</div>
        ) : (
          <table className="list">
            <tbody>
              {s.bids.map((b, i) => (
                <tr key={b.id}>
                  <td>
                    {b.who}
                    {i === 0 && <span className="pill accent" style={{ marginLeft: 6 }}>{open ? "Leading" : "Winner"}</span>}
                  </td>
                  <td style={{ fontWeight: 600 }}>{formatMoney(b.amount_cents)}</td>
                  <td className="muted" suppressHydrationWarning>{dateTime(b.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
