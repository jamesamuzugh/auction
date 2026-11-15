# Bidwell: auctions for pre-loved goods

An auction site for (mostly used) items. Sellers list an item with a **starting bid**, a
**minimum bid increment** and a **fixed end time**. Buyers bid; when the time runs out the
highest bidder wins, adds a shipping address, pays online through **Paystack**, and the seller
ships with tracking until the buyer confirms delivery.

## Features

- Accounts (email + password, hashed with scrypt; HTTP-only session cookie)
- Listings with photo, category, condition, starting bid, minimum increment, and an end time
  (preset lengths or a custom date and time)
- Bidding rules enforced on the server inside a write-locked transaction: first bid must meet
  the starting bid, every later bid must beat the current one by at least the increment,
  sellers can't bid on their own items, nobody can bid after the end time
- Live auction page: countdown, current price and bid history refresh every 3 seconds;
  bidder names are masked (`E***r`)
- Automatic close: due auctions are closed on the next request, the winner is recorded and an
  order is opened
- Order tracking: address → payment → paid → shipped (carrier + tracking number) → delivered,
  with a history log visible only to the buyer and seller
- Payments: Paystack checkout, callback verification and signed webhooks; amounts and currency
  are re-checked with Paystack before an order is marked paid. Other providers plug into
  `src/lib/payments/` (see `types.ts`). If no provider is configured the seller confirms
  payment by hand instead.
- My account page: items won, auctions you're bidding on (leading / outbid), your listings

## Stack

Next.js 15 (App Router, server actions) · React 19 · TypeScript · SQLite via Node's built-in
`node:sqlite` (Node 22.5+; no native modules to compile).

## Running it

```bash
npm install
cp .env.example .env.local      # set currency and Paystack key
npm run seed                    # optional demo data (password123 for all demo users)
npm run dev                     # http://localhost:3000
```

Production: `npm run build && npm start`. The database lives in `data/auction.db` and uploaded
photos in `public/uploads/`; both need persistent disk (a VPS, Railway, Render or Fly volume).
Serverless hosts with read-only disks (e.g. Vercel) would need Postgres and object storage
instead.

### Paystack setup

1. Get your secret key from the Paystack dashboard (Settings → API Keys & Webhooks). Use the
   `sk_test_…` key while testing.
2. Set `PAYSTACK_SECRET_KEY` and `APP_URL` in `.env.local`.
3. Set the webhook URL in the dashboard to `<APP_URL>/api/payments/paystack/webhook`.

To try the full flow without keys, set `PAYMENTS_DEMO=1` to get a pretend checkout. Never turn
that on in production.

## Tests

```bash
npm test
```

Covers bid rules, closing and winner selection, the order/shipping state machine, payment
recording (double notifications, underpayment, wrong currency) and the Paystack client
(endpoint calls and webhook signatures).

## Not built yet

- Paying sellers out (Paystack subaccounts/split payments, or manual payouts) and a platform fee
- Email/SMS notifications (outbid, won, shipped)
- Anti-sniping (extending the end time when a bid lands in the last minutes)
- Admin moderation of listings and disputes
