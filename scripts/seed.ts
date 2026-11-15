// Fills the database with demo users and auctions: npm run seed
import { getDb } from "../src/lib/db.ts";
import { registerUser, authenticate } from "../src/lib/users.ts";
import {
  applyPaymentResult,
  closeDueAuctions,
  createAuction,
  createPayment,
  getOrderForAuction,
  markShipped,
  placeBid,
  setShippingAddress,
} from "../src/lib/auctions.ts";

const db = getDb();
const user = (email: string, name: string) => {
  try {
    return registerUser(db, email, name, "password123");
  } catch {
    return authenticate(db, email, "password123");
  }
};
const seller = user("seller@example.com", "Ama Seller");
const buyer = user("buyer@example.com", "Kofi Buyer");
const other = user("bidder@example.com", "Esi Bidder");
user("admin@example.com", "Bidwell Admin"); // add admin@example.com to ADMIN_EMAILS

const now = Date.now();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const items = [
  ["Samsung Galaxy S21, 128GB", "Phones & Tablets", "Used - Good", 80000, 2000, 3 * DAY, "Light scratches on the back, screen is perfect. Comes with charger."],
  ["Dell Latitude 7490 laptop", "Computers", "Used - Good", 150000, 5000, 5 * DAY, "i5, 16GB RAM, 256GB SSD. Battery holds about 4 hours."],
  ["Wooden study desk", "Furniture", "Used - Fair", 30000, 1000, 2 * DAY, "Solid wood, a few marks on the top. Pickup or delivery."],
  ["Canon EOS 2000D camera kit", "Electronics", "Used - Like new", 200000, 5000, 7 * DAY, "Used twice. 18-55mm lens, bag and memory card included."],
  ["Men's leather jacket, size L", "Fashion", "Used - Good", 15000, 500, 1 * DAY, "Genuine leather, worn one season."],
  ["Mountain bike, 26 inch", "Sports & Outdoors", "Used - Fair", 60000, 2000, 10 * MIN, "Needs new brake pads, otherwise rides well."],
] as const;

for (const [title, category, condition, start, inc, len, description] of items) {
  const id = createAuction(db, {
    sellerId: seller.id, title, description, category, condition, imagePath: null,
    startingBidCents: start, minIncrementCents: inc, endsAt: now + len,
  });
  if (start < 100000) {
    placeBid(db, id, other.id, start);
    placeBid(db, id, buyer.id, start + inc);
  }
}
// Two auctions that already ended and were won by the buyer, so the escrow flow can be tried at once.
const addr = { name: "Kofi Buyer", phone: "0240000000", line1: "12 Ring Road", city: "Accra", region: "Greater Accra", country: "Ghana" };
const ended = [
  ["Kenwood stand mixer", "Home & Kitchen", 40000, "Works perfectly, bowl and three attachments."],
  ["Nintendo Switch with 2 games", "Toys & Games", 120000, "Screen protector on since day one. Joy-cons don't drift."],
] as const;
ended.forEach(([title, category, start, description], i) => {
  const t0 = now - 3 * HOUR;
  const id = createAuction(db, {
    sellerId: seller.id, title, description, category, condition: "Used - Good", imagePath: null,
    startingBidCents: start, minIncrementCents: 1000, endsAt: t0 + 2 * MIN,
  }, t0);
  placeBid(db, id, other.id, start, t0 + MIN);
  placeBid(db, id, buyer.id, start + 2000, t0 + MIN + 1);
  closeDueAuctions(db, now);
  const o = getOrderForAuction(db, id)!;
  setShippingAddress(db, o.id, buyer.id, addr);
  if (i === 1) {
    const p = createPayment(db, o.id, buyer.id, "demo", process.env.NEXT_PUBLIC_CURRENCY ?? "GHS");
    applyPaymentResult(db, p.reference, { status: "success", amountCents: p.amount_cents, currency: p.currency }, "demo checkout");
    markShipped(db, o.id, seller.id, "DHL", "GH4471902");
  }
});

console.log("Seeded. Sign in as seller@example.com, buyer@example.com or bidder@example.com with password123 (admin: admin@example.com).");
