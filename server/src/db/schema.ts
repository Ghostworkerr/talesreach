import { sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
});

/** Device logins: each device holds a random secret; we store only its SHA-256. */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
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
];
