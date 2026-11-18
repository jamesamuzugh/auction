import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  -- 'courier' accounts belong to a delivery partner and confirm deliveries.
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','courier')),
  company       TEXT,
  -- Verification: a phone confirmed by SMS code, and an ID document checked by a Bidwell admin.
  phone             TEXT,
  phone_verified_at INTEGER,
  id_status         TEXT NOT NULL DEFAULT 'none' CHECK (id_status IN ('none','pending','verified','rejected')),
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS phone_codes (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  sent_at    INTEGER NOT NULL,
  -- Rate limit: sends in the current hour-long window.
  window_start INTEGER NOT NULL,
  window_sends INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS id_checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type      TEXT NOT NULL CHECK (doc_type IN ('ghana_card','passport','drivers_licence','voter_id')),
  doc_number    TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  front_path    TEXT NOT NULL,
  back_path     TEXT,
  selfie_path   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason        TEXT,
  reviewed_by   INTEGER REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  reviewed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS id_checks_user ON id_checks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS id_checks_doc ON id_checks(doc_number);

-- Delivery price for each item size and distance band. Admins edit it on /admin.
CREATE TABLE IF NOT EXISTS delivery_rates (
  size       TEXT NOT NULL,
  band       TEXT NOT NULL,
  fee_cents  INTEGER NOT NULL CHECK (fee_cents >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (size, band)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auctions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id            INTEGER NOT NULL REFERENCES users(id),
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  category             TEXT NOT NULL DEFAULT 'Other',
  condition            TEXT NOT NULL DEFAULT 'Used - Good',
  image_path           TEXT,
  -- Delivery is priced on the item's size and how far it travels from here.
  size                 TEXT NOT NULL DEFAULT 'medium' CHECK (size IN ('small','medium','large','xl')),
  pickup_city          TEXT,
  pickup_region        TEXT,
  starting_bid_cents   INTEGER NOT NULL CHECK (starting_bid_cents > 0),
  min_increment_cents  INTEGER NOT NULL CHECK (min_increment_cents > 0),
  current_bid_cents    INTEGER,
  current_bidder_id    INTEGER REFERENCES users(id),
  bid_count            INTEGER NOT NULL DEFAULT 0,
  starts_at            INTEGER NOT NULL,
  ends_at              INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  winner_id            INTEGER REFERENCES users(id),
  created_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auctions_status_end ON auctions(status, ends_at);

CREATE TABLE IF NOT EXISTS bids (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id   INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bids_auction ON bids(auction_id, amount_cents DESC);
CREATE INDEX IF NOT EXISTS bids_user ON bids(user_id);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id      INTEGER NOT NULL UNIQUE REFERENCES auctions(id),
  buyer_id        INTEGER NOT NULL REFERENCES users(id),
  seller_id       INTEGER NOT NULL REFERENCES users(id),
  amount_cents    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'awaiting_address'
                  CHECK (status IN ('awaiting_address','awaiting_payment','paid','shipped','delivered',
                                    'returning','returned','disputed','completed','refunded','cancelled')),
  -- What the winner pays: the winning bid plus delivery.
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL DEFAULT 0,
  -- Failed delivery: after 3 attempts the item goes back to the seller at the winner's cost.
  return_fee_cents INTEGER NOT NULL DEFAULT 0,
  return_code     TEXT,
  returned_at     INTEGER,
  ship_name       TEXT,
  ship_phone      TEXT,
  ship_line1      TEXT,
  ship_line2      TEXT,
  ship_city       TEXT,
  ship_region     TEXT,
  ship_postal     TEXT,
  ship_country    TEXT,
  carrier         TEXT,
  tracking_number TEXT,
  -- Escrow: Bidwell holds the money from payment until it is released to the seller or refunded.
  escrow_status   TEXT NOT NULL DEFAULT 'none' CHECK (escrow_status IN ('none','held','frozen','released','refunded')),
  shipped_at      INTEGER,
  -- Delivery: the partner confirms handover with the buyer's code or signature.
  courier_id      INTEGER REFERENCES users(id),
  delivery_code   TEXT,
  delivery_code_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_method TEXT CHECK (delivery_method IN ('code','signature','admin')),
  delivery_recipient TEXT,
  delivery_signature TEXT,
  accepted_at     INTEGER,
  delivered_at    INTEGER,
  release_at      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  provider     TEXT NOT NULL,
  reference    TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  provider_ref TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS disputes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  opened_by       INTEGER NOT NULL REFERENCES users(id),
  reason          TEXT NOT NULL,
  details         TEXT NOT NULL,
  prev_status     TEXT NOT NULL,
  seller_response TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','refunded','released','resumed')),
  admin_note      TEXT,
  resolved_by     INTEGER REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  resolved_at     INTEGER
);
CREATE INDEX IF NOT EXISTS disputes_order ON disputes(order_id);

CREATE TABLE IF NOT EXISTS payout_accounts (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id),
  method         TEXT NOT NULL CHECK (method IN ('bank','mobile_money')),
  bank_code      TEXT NOT NULL,
  bank_name      TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name   TEXT NOT NULL,
  recipient_code TEXT,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  seller_id      INTEGER NOT NULL REFERENCES users(id),
  gross_cents    INTEGER NOT NULL,
  fee_cents      INTEGER NOT NULL,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('waiting_details','pending','processing','paid','failed')),
  reference      TEXT NOT NULL UNIQUE,
  provider       TEXT,
  provider_ref   TEXT,
  failure_reason TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  payment_reference TEXT,
  provider          TEXT,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending','processing','processed','failed','manual')),
  provider_ref      TEXT,
  failure_reason    TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  courier_id INTEGER NOT NULL REFERENCES users(id),
  attempt_no INTEGER NOT NULL,
  note       TEXT NOT NULL,
  photo_path TEXT NOT NULL,
  lat        REAL,
  lng        REAL,
  accuracy_m REAL,
  created_at INTEGER NOT NULL,
  UNIQUE (order_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL
);
`;

const cache = new Map<string, DatabaseSync>();

export function dbPath(): string {
  return process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "auction.db");
}

/** Opens (and migrates) the SQLite database. One connection per file per process. */
export function getDb(file: string = dbPath()): DatabaseSync {
  let db = cache.get(file);
  if (!db) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec(SCHEMA);
    migrate(db);
    plainRows(db);
    cache.set(file, db);
  }
  return db;
}

/** Columns added after a table was first created. CREATE TABLE IF NOT EXISTS won't add them to an existing database. */
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  ["users", "phone", "TEXT"],
  ["users", "phone_verified_at", "INTEGER"],
  ["users", "id_status", "TEXT NOT NULL DEFAULT 'none'"],
  ["auctions", "size", "TEXT NOT NULL DEFAULT 'medium'"],
  ["auctions", "pickup_city", "TEXT"],
  ["auctions", "pickup_region", "TEXT"],
];

function migrate(db: DatabaseSync) {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_verified_phone ON users(phone) WHERE phone_verified_at IS NOT NULL`);
}

/**
 * node:sqlite returns rows with a null prototype, which React refuses to pass to client
 * components. Copy them into plain objects once, here, so callers never have to think about it.
 */
function plainRows(db: DatabaseSync) {
  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const st = prepare(sql);
    const get = st.get.bind(st);
    const all = st.all.bind(st);
    st.get = ((...a: Parameters<typeof get>) => {
      const r = get(...a);
      return r ? { ...r } : r;
    }) as typeof st.get;
    st.all = ((...a: Parameters<typeof all>) => all(...a).map((r) => ({ ...r }))) as typeof st.all;
    return st;
  };
}

/** Runs fn inside an IMMEDIATE transaction so concurrent bids serialize on the write lock. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
