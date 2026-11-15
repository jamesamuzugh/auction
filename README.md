# Bidwell: auctions for pre-loved goods

An auction site for (mostly used) items. Sellers list an item with a **starting bid**, a
**minimum bid increment** and a **fixed end time**. Buyers bid; when the time runs out the
highest bidder wins, adds a shipping address and pays **Bidwell** through **Paystack**. Bidwell
holds the money in **escrow** while the seller ships, and only pays the seller once the buyer
confirms delivery and **6 hours pass without a reported problem**.

## How escrow works

| Step | Money |
| --- | --- |
| Winner pays | Held by Bidwell (`escrow_status = held`) |
| Seller hands the item to a Bidwell delivery partner | Still held; the winner gets a 6-digit delivery code |
| Delivery partner confirms handover with the winner's code or signature | Still held; 6-hour window starts |
| Winner accepts the item as in good condition | Released at once to the seller, less `PLATFORM_FEE_PERCENT` |
| 6 hours pass with no acceptance and no report | Released to the seller |
| Winner reports a problem (any time after paying, until the window ends) | Frozen until an admin decides |
| Admin decides | Refund the winner, pay the seller, or let the order continue |

- Payouts go to the seller's bank account or mobile money wallet via Paystack Transfers;
  refunds go back through Paystack Refunds. Both are queued, claimed before sending (so they
  can't double-send) and confirmed by webhook; failures show on `/admin` with a Retry button.
- Delivery partners are ordinary accounts an admin promotes on `/admin`. Their `/deliveries`
  page lists parcels with the address and a form to confirm with the code (5 wrong tries, then
  signature only) or a signature drawn on screen. Admins can confirm by hand as a fallback.
- `/admin` (emails in `ADMIN_EMAILS`) shows held and frozen money, open reports, payouts,
  refunds, and lets an admin record an offline payment made into Bidwell's own account.
- Releases happen on page loads and from `GET /api/cron/escrow` (send
  `Authorization: Bearer $CRON_SECRET`); schedule that every 5 minutes in production.

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
- Order tracking: address → payment → paid → shipped (carrier + tracking number) → delivered →
  seller paid, with a history log visible only to the buyer, the seller and admins
- Escrow, disputes, seller payouts and refunds (see above); sellers manage payout details and see
  held/paid amounts at `/account/payouts`
- Payments: Paystack checkout, callback verification and signed webhooks; amounts and currency
  are re-checked with Paystack before an order is marked paid. Other providers plug into
  `src/lib/payments/` (see `types.ts`). If no provider is configured, an admin can record a
  payment made offline into Bidwell's account.
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
4. For automatic seller payouts, turn off transfer OTP ("Confirm transfers before sending") in
   Paystack, and keep enough in your Paystack balance to cover payouts.

To try the full flow without keys, set `PAYMENTS_DEMO=1` to get a pretend checkout. Never turn
that on in production.

## Tests

```bash
npm test
```

Covers escrow holds and releases, the 6-hour window, auto-confirmation, disputes (refund /
release / resume), payout and refund processing and retries, bid rules, closing and winner selection, the order/shipping state machine, payment
recording (double notifications, underpayment, wrong currency) and the Paystack client
(endpoint calls and webhook signatures).

## Not built yet

- Email/SMS notifications (outbid, won, shipped)
- Anti-sniping (extending the end time when a bid lands in the last minutes)
- Admin moderation of listings, and photo uploads on dispute reports
- Verifying payout account names with Paystack before saving
