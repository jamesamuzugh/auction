import { requireUser } from "@/lib/server.ts";
import { CATEGORIES, CONDITIONS } from "@/lib/auctions.ts";
import SellForm from "@/components/SellForm.tsx";

export default async function Sell() {
  await requireUser("/sell");
  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <h1>Sell an item</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Set a starting bid, how much each bid must go up by, and when bidding closes. The highest bidder at the end wins.
      </p>
      <div className="card pad">
        <SellForm categories={CATEGORIES} conditions={CONDITIONS} />
      </div>
    </div>
  );
}
