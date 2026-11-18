import Link from "next/link";
import { getDb } from "@/lib/db.ts";
import { requireUser } from "@/lib/server.ts";
import { verificationFor } from "@/lib/verify.ts";
import { CATEGORIES, CONDITIONS } from "@/lib/auctions.ts";
import SellForm from "@/components/SellForm.tsx";

export default async function Sell() {
  const me = await requireUser("/sell");
  const v = verificationFor(getDb(), me.id);
  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <h1>Sell an item</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Set a starting bid, how much each bid must go up by, and when bidding closes. The highest bidder at the end wins.
      </p>
      {v.verified ? (
        <div className="card pad">
          <SellForm categories={CATEGORIES} conditions={CONDITIONS} />
        </div>
      ) : (
        <div className="card pad stack">
          <h2 style={{ margin: 0 }}>Verify your account to sell</h2>
          <p style={{ margin: 0 }}>
            Every seller on Bidwell confirms their phone number and has their ID checked once, so buyers know who they&apos;re dealing with.
            {v.idStatus === "pending" && " Your ID is being checked now. You can list items as soon as it's approved."}
          </p>
          <div><Link className="btn primary" href="/account/verify?next=/sell">{v.idStatus === "pending" ? "See verification status" : "Verify now"}</Link></div>
        </div>
      )}
    </div>
  );
}
