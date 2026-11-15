import Link from "next/link";
import { db } from "@/lib/server.ts";
import { CATEGORIES, listAuctions } from "@/lib/auctions.ts";
import AuctionCard from "@/components/AuctionCard.tsx";

export const dynamic = "force-dynamic";

type SP = Promise<{ q?: string; category?: string; sort?: string; view?: string }>;

export default async function Home({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view = sp.view === "ended" ? "ended" : "active";
  const sort = sp.sort === "newest" || sp.sort === "price" ? sp.sort : "ending";
  const items = listAuctions(db(), {
    status: view,
    q: sp.q?.trim() || undefined,
    category: CATEGORIES.includes(sp.category ?? "") ? sp.category : undefined,
    sort,
  });
  const qs = (v: string) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (sp.category) p.set("category", sp.category);
    if (v !== "active") p.set("view", v);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <>
      <section className="hero">
        <h1>Great finds, second time around</h1>
        <p className="muted" style={{ margin: 0 }}>
          Bid on pre-loved items. When the timer runs out, the highest bid wins and the item ships to you.
        </p>
      </section>

      <form className="filters" action="/">
        <input name="q" placeholder="Search items" defaultValue={sp.q} aria-label="Search" />
        <select name="category" defaultValue={sp.category ?? ""} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort">
          <option value="ending">Ending soonest</option>
          <option value="newest">Newly listed</option>
          <option value="price">Lowest price</option>
        </select>
        {view === "ended" && <input type="hidden" name="view" value="ended" />}
        <button className="btn">Search</button>
      </form>

      <div className="tabs">
        <Link href={qs("active")} className={view === "active" ? "on" : ""}>
          Live auctions
        </Link>
        <Link href={qs("ended")} className={view === "ended" ? "on" : ""}>
          Recently closed
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="card empty-state">
          {view === "active" ? (
            <>
              <p>No live auctions match right now.</p>
              <Link href="/sell" className="btn primary">
                List something to sell
              </Link>
            </>
          ) : (
            <p>No closed auctions yet.</p>
          )}
        </div>
      ) : (
        <div className="grid">
          {items.map((a) => (
            <AuctionCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </>
  );
}
