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
  created_at    INTEGER NOT NULL
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
                  CHECK (status IN ('awaiting_address','awaiting_payment','paid','shipped','delivered','cancelled')),
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
    plainRows(db);
    cache.set(file, db);
  }
  return db;
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
