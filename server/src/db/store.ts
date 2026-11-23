import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { SAVE_CODE_ALPHABET } from "@talesreach/shared";
import { CREATE_TABLES, accounts, blocks, reports, sessions } from "./schema.js";

export type Account = typeof accounts.$inferSelect;
export type Report = typeof reports.$inferSelect;

/** Public player id (shown to other players for mute/block/report/invite); never the account id. */
export const publicId = (accountId: string) => createHash("sha256").update(`pid:${accountId}`).digest("hex").slice(0, 12);

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

/** Everything the game needs from account storage. Two implementations below. */
export interface AccountStore {
  createGuest(dob: string): Promise<{ account: Account; token: string }>;
  byToken(token: string): Promise<Account | undefined>;
  rotateSaveCode(accountId: string): Promise<string>;
  loginWithSaveCode(code: string): Promise<{ account: Account; token: string } | undefined>;
  touch(accountId: string): Promise<void>;
  block(accountId: string, blockedId: string): Promise<void>;
  unblock(accountId: string, blockedId: string): Promise<void>;
  blockedEitherWay(accountId: string): Promise<Set<string>>;
  addReport(r: NewReport): Promise<Report>;
  listReports(status: string, limit?: number): Promise<Report[]>;
  setReportStatus(id: number, status: string): Promise<void>;
  /** Save name + appearance. Returns false if another character already has that name. */
  setProfile(accountId: string, name: string, appearance: string): Promise<boolean>;
}

/**
 * Accounts in SQL (Drizzle): real Postgres when DATABASE_URL is set, or the
 * in-memory PGlite Postgres used by the tests to check the SQL.
 */
export class SqlAccountStore implements AccountStore {
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

  async block(accountId: string, blockedId: string) {
    await this.db.insert(blocks).values({ accountId, blockedId }).onConflictDoNothing();
  }

  async unblock(accountId: string, blockedId: string) {
    await this.db.delete(blocks).where(and(eq(blocks.accountId, accountId), eq(blocks.blockedId, blockedId)));
  }

  /** Everyone this account has blocked, and everyone who has blocked it (blocking hides both ways). */
  async blockedEitherWay(accountId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ a: blocks.accountId, b: blocks.blockedId })
      .from(blocks)
      .where(or(eq(blocks.accountId, accountId), eq(blocks.blockedId, accountId)));
    return new Set(rows.map((r) => (r.a === accountId ? r.b : r.a)));
  }

  async addReport(r: NewReport) {
    const [row] = await this.db
      .insert(reports)
      .values({ ...r, evidence: JSON.stringify(r.evidence) })
      .returning();
    return row!;
  }

  async listReports(status: string, limit = 100): Promise<Report[]> {
    return this.db.select().from(reports).where(eq(reports.status, status)).orderBy(desc(reports.createdAt)).limit(limit);
  }

  async setReportStatus(id: number, status: string) {
    await this.db.update(reports).set({ status }).where(eq(reports.id, id));
  }

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

export interface NewReport {
  reporterId: string;
  reportedId: string;
  reportedName: string;
  reason: string;
  note: string;
  evidence: unknown[];
}

/** Postgres "unique_violation" (23505), however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/**
 * Accounts kept in plain memory: used when no database is connected. Very light
 * (free hosting gives the whole server 512 MB), and resets when the server restarts.
 * Behaves exactly like the SQL store (the same contract tests run against both).
 */
export class MemoryAccountStore implements AccountStore {
  private readonly accounts = new Map<string, Account>();
  private readonly sessions = new Map<string, string>(); // token hash -> account id
  private readonly blocks = new Set<string>(); // "a|b": a blocked b
  private readonly reports: Report[] = [];
  private nextReport = 1;

  async createGuest(dob: string) {
    const now = new Date();
    const account: Account = { id: randomUUID(), dob, name: "", appearance: "{}", saveCodeHash: null, createdAt: now, lastSeenAt: now };
    this.accounts.set(account.id, account);
    const token = newToken();
    this.sessions.set(sha256(token), account.id);
    return { account: { ...account }, token };
  }

  async byToken(token: string) {
    const id = this.sessions.get(sha256(token));
    const a = id ? this.accounts.get(id) : undefined;
    return a ? { ...a } : undefined;
  }

  async rotateSaveCode(accountId: string) {
    const code = newSaveCode();
    const a = this.accounts.get(accountId);
    if (a) a.saveCodeHash = sha256(code);
    return code;
  }

  async loginWithSaveCode(code: string) {
    const hash = sha256(code);
    const account = [...this.accounts.values()].find((a) => a.saveCodeHash === hash);
    if (!account) return undefined;
    const token = newToken();
    this.sessions.set(sha256(token), account.id);
    return { account: { ...account }, token };
  }

  async touch(accountId: string) {
    const a = this.accounts.get(accountId);
    if (a) a.lastSeenAt = new Date();
  }

  async block(accountId: string, blockedId: string) {
    this.blocks.add(`${accountId}|${blockedId}`);
  }

  async unblock(accountId: string, blockedId: string) {
    this.blocks.delete(`${accountId}|${blockedId}`);
  }

  async blockedEitherWay(accountId: string) {
    const out = new Set<string>();
    for (const pair of this.blocks) {
      const [a, b] = pair.split("|") as [string, string];
      if (a === accountId) out.add(b);
      else if (b === accountId) out.add(a);
    }
    return out;
  }

  async addReport(r: NewReport) {
    const row: Report = { ...r, id: this.nextReport++, evidence: JSON.stringify(r.evidence), status: "open", strikes: 0, createdAt: new Date() };
    this.reports.push(row);
    return { ...row };
  }

  async listReports(status: string, limit = 100) {
    return this.reports
      .filter((r) => r.status === status)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || y.id - x.id)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async setReportStatus(id: number, status: string) {
    const r = this.reports.find((x) => x.id === id);
    if (r) r.status = status;
  }

  async setProfile(accountId: string, name: string, appearance: string) {
    const lower = name.toLowerCase();
    // Same rule as the database's unique index: names are unique ignoring capitals.
    for (const a of this.accounts.values()) if (a.id !== accountId && a.name !== "" && a.name.toLowerCase() === lower) return false;
    const a = this.accounts.get(accountId);
    if (a) Object.assign(a, { name, appearance });
    return true;
  }
}

/**
 * Open the account store:
 * - DATABASE_URL set: real Postgres (Neon/Supabase), saves survive restarts;
 * - otherwise plain memory (light; resets when the server restarts);
 * - `engine: "pglite"` (tests): an in-memory Postgres, to check the SQL itself.
 */
export async function openStore(
  databaseUrl = process.env.DATABASE_URL,
  opts: { engine?: "memory" | "pglite" } = {},
): Promise<{ store: AccountStore; persistent: boolean }> {
  if (databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
    const store = new SqlAccountStore(drizzle(pool) as unknown as Db);
    await store.migrate();
    return { store, persistent: true };
  }
  if (opts.engine === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const store = new SqlAccountStore(drizzle(new PGlite()) as unknown as Db);
    await store.migrate();
    return { store, persistent: false };
  }
  return { store: new MemoryAccountStore(), persistent: false };
}
