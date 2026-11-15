// Fills the database with demo users and auctions: npm run seed
import { getDb } from "../src/lib/db.ts";
import { registerUser, authenticate } from "../src/lib/users.ts";
import { createAuction, placeBid } from "../src/lib/auctions.ts";

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
console.log("Seeded. Sign in as seller@example.com, buyer@example.com or bidder@example.com with password123.");
