import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { SAVE_CODE_ALPHABET } from "@talesreach/shared";
import { CREATE_TABLES, accounts, sessions } from "./schema.js";

export type Account = typeof accounts.$inferSelect;

type Db = PgDatabase<PgQueryResultHKT, Record<string, never>>;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A new device secret (sent to the client once; we keep only its hash). */
export const newToken = () => randomBytes(32).toString("base64url");

/** A 12-character save code from an alphabet without look-alike characters. */
export function newSaveCode(): string {
  // Rejection sampling: only use bytes below the largest multiple of the alphabet size (no bias).
  const n = SAVE_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < 12) {
    for (const b of randomBytes(16)) {
      if (b < limit && out.length < 12) out += SAVE_CODE_ALPHABET[b % n];
    }
  }
  return out;
}

/**
 * Player accounts. Works the same on real Postgres (DATABASE_URL) and on the
 * in-memory Postgres used for development and tests.
 */
export class AccountStore {
  constructor(private readonly db: Db) {}

  async migrate() {
    for (const statement of CREATE_TABLES) await this.db.execute(statement);
  }

  /** Create a guest account and return it with its first device token. */
  async createGuest(dob: string): Promise<{ account: Account; token: string }> {
    const id = randomUUID();
    const token = newToken();
    const [account] = await this.db.insert(accounts).values({ id, dob }).returning();
    await this.db.insert(sessions).values({ tokenHash: sha256(token), accountId: id });
    return { account: account!, token };
  }

  async byToken(token: string): Promise<Account | undefined> {
    const rows = await this.db
      .select({ account: accounts })
      .from(sessions)
      .innerJoin(accounts, eq(sessions.accountId, accounts.id))
      .where(eq(sessions.tokenHash, sha256(token)))
      .limit(1);
    return rows[0]?.account;
  }

  /** Make (or replace) the save code. The old code stops working. */
  async rotateSaveCode(accountId: string): Promise<string> {
    const code = newSaveCode();
    await this.db.update(accounts).set({ saveCodeHash: sha256(code) }).where(eq(accounts.id, accountId));
    return code;
  }

  /** Log in on a new device with a save code; returns a fresh device token. */
  async loginWithSaveCode(code: string): Promise<{ account: Account; token: string } | undefined> {
    const [account] = await this.db.select().from(accounts).where(eq(accounts.saveCodeHash, sha256(code))).limit(1);
    if (!account) return undefined;
    const token = newToken();
    await this.db.insert(sessions).values({ tokenHash: sha256(token), accountId: account.id });
    return { account, token };
  }

  async touch(accountId: string) {
    await this.db.update(accounts).set({ lastSeenAt: new Date() }).where(eq(accounts.id, accountId));
  }

  /** Save name + appearance. Returns false if another character already has that name. */
  async setProfile(accountId: string, name: string, appearance: string): Promise<boolean> {
    try {
      await this.db.update(accounts).set({ name, appearance }).where(eq(accounts.id, accountId));
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
}

/** Postgres "unique_violation" (23505), however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/**
 * Open the account store: real Postgres when DATABASE_URL is set (Neon/Supabase),
 * otherwise an in-memory Postgres (fine for development; resets on restart).
 */
export async function openStore(databaseUrl = process.env.DATABASE_URL): Promise<{ store: AccountStore; persistent: boolean }> {
  let db: Db;
  let persistent = false;
  if (databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: databaseUrl, max: 5, ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false } });
    db = drizzle(pool) as unknown as Db;
    persistent = true;
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    db = drizzle(new PGlite()) as unknown as Db;
  }
  const store = new AccountStore(db);
  await store.migrate();
  return { store, persistent };
}
