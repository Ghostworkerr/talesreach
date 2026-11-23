import { sql } from "drizzle-orm";
import { integer, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";

/** One row per player account (guest or saved). */
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  /** YYYY-MM-DD; needed to know when a minor account becomes adult. Never shown to anyone. */
  dob: text("dob").notNull(),
  /** Display name chosen in the character creator (empty until then). */
  name: text("name").notNull().default(""),
  /** Appearance choices from the character creator, as JSON (validated by the server). */
  appearance: text("appearance").notNull().default("{}"),
  /** SHA-256 of the current save code, if the player made one. */
  saveCodeHash: text("save_code_hash").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  /** Coins carried, and coins kept in the inn-room chest. Changed only in transactions, always logged. */
  coins: integer("coins").notNull().default(0),
  chestCoins: integer("chest_coins").notNull().default(0),
  /** The inn room is rented until this moment (null = no room). */
  roomUntil: timestamp("room_until", { withTimezone: true }),
  /** Which bed the player last rested in (they wake there while the room is rented). */
  restPoint: text("rest_point"),
});

/** Append-only record of every coin change (CLAUDE.md security rules). Never updated or deleted. */
export const economyLog = pgTable("economy_log", {
  id: serial("id").primaryKey(),
  accountId: text("account_id").notNull(),
  /** Change to coins carried and to the chest (either may be 0). */
  coinsDelta: integer("coins_delta").notNull(),
  chestDelta: integer("chest_delta").notNull(),
  coinsAfter: integer("coins_after").notNull(),
  chestAfter: integer("chest_after").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Device logins: each device holds a random secret; we store only its SHA-256. */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Player A has blocked player B: B's chat and invites never reach A (and vice versa). */
export const blocks = pgTable(
  "blocks",
  {
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.blockedId] })],
);

/** Player reports: the admin queue. Evidence is the recent chat, captured by the server. */
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  reporterId: text("reporter_id").notNull(),
  reportedId: text("reported_id").notNull(),
  reportedName: text("reported_name").notNull(),
  reason: text("reason").notNull(),
  note: text("note").notNull().default(""),
  evidence: text("evidence").notNull().default("[]"),
  status: text("status").notNull().default("open"),
  strikes: integer("strikes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Create tables if missing (small, explicit migration run at start-up; one statement each). */
export const CREATE_TABLES = [
  sql`CREATE TABLE IF NOT EXISTS accounts (
    id text PRIMARY KEY,
    dob text NOT NULL,
    name text NOT NULL DEFAULT '',
    appearance text NOT NULL DEFAULT '{}',
    save_code_hash text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id)`,
  // Character names are unique, ignoring capital letters (empty = not chosen yet).
  sql`CREATE UNIQUE INDEX IF NOT EXISTS accounts_name_unique ON accounts (lower(name)) WHERE name <> ''`,
  sql`CREATE TABLE IF NOT EXISTS blocks (
    account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    blocked_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, blocked_id)
  )`,
  sql`CREATE TABLE IF NOT EXISTS reports (
    id serial PRIMARY KEY,
    reporter_id text NOT NULL,
    reported_id text NOT NULL,
    reported_name text NOT NULL,
    reason text NOT NULL,
    note text NOT NULL DEFAULT '',
    evidence text NOT NULL DEFAULT '[]',
    status text NOT NULL DEFAULT 'open',
    strikes integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status, created_at)`,
  sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS coins integer NOT NULL DEFAULT 0`,
  sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS chest_coins integer NOT NULL DEFAULT 0`,
  sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS room_until timestamptz`,
  sql`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS rest_point text`,
  sql`CREATE TABLE IF NOT EXISTS economy_log (
    id serial PRIMARY KEY,
    account_id text NOT NULL,
    coins_delta integer NOT NULL,
    chest_delta integer NOT NULL,
    coins_after integer NOT NULL,
    chest_after integer NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS economy_log_account_idx ON economy_log(account_id, id)`,
];
