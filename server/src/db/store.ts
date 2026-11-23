import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { SAVE_CODE_ALPHABET, STARTING_COINS, WORLD_DAY_MS, type Wallet } from "@talesreach/shared";
import { CREATE_TABLES, accounts, blocks, economyLog, reports, sessions } from "./schema.js";

export type Account = typeof accounts.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type EconomyEntry = typeof economyLog.$inferSelect;
export type CoinResult = "ok" | "poor" | "empty";

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

  // --- economy: every change is atomic and written to the economy log ---
  wallet(accountId: string): Promise<Wallet>;
  /** Pay for one more world day of inn room (from now, or from the end of the current rental). */
  rentRoom(accountId: string, price: number, nowMs: number): Promise<CoinResult>;
  /** Move coins between purse and chest: positive = put in the chest, negative = take out. */
  moveChestCoins(accountId: string, amount: number): Promise<CoinResult>;
  setRestPoint(accountId: string, point: string | null): Promise<void>;
  economyLog(accountId: string): Promise<EconomyEntry[]>;
  /** Pay coins for something (a song, a drink...). Never goes below zero. */
  spend(accountId: string, amount: number, reason: string): Promise<CoinResult>;
}

const toWallet = (a: Account): Wallet => ({
  coins: a.coins,
  chest: a.chestCoins,
  roomUntil: a.roomUntil?.getTime() ?? 0,
  restPoint: a.restPoint,
});

/** The new room end time: one world day from now, or from the end of a rental still running. */
const extendRoom = (current: Date | null, nowMs: number) =>
  new Date(Math.max(nowMs, current?.getTime() ?? 0) + WORLD_DAY_MS);

/**
 * Accounts in SQL (Drizzle): real Postgres when DATABASE_URL is set, or the
 * in-memory PGlite Postgres used by the tests to check the SQL.
 */
export class SqlAccountStore implements AccountStore {
  constructor(private readonly db: Db) {}

  async migrate() {
    for (const statement of CREATE_TABLES) await this.db.execute(statement);
  }

  /** Create a guest account (with the starting purse, logged) and return it with its first device token. */
  async createGuest(dob: string): Promise<{ account: Account; token: string }> {
    const id = randomUUID();
    const token = newToken();
    const account = await this.db.transaction(async (tx) => {
      const [row] = await tx.insert(accounts).values({ id, dob, coins: STARTING_COINS }).returning();
      await tx.insert(sessions).values({ tokenHash: sha256(token), accountId: id });
      await tx.insert(economyLog).values({
        accountId: id, coinsDelta: STARTING_COINS, chestDelta: 0, coinsAfter: STARTING_COINS, chestAfter: 0, reason: "starting_purse",
      });
      return row!;
    });
    return { account, token };
  }

  async wallet(accountId: string): Promise<Wallet> {
    const [a] = await this.db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    return a ? toWallet(a) : { coins: 0, chest: 0, roomUntil: 0, restPoint: null };
  }

  async rentRoom(accountId: string, price: number, nowMs: number): Promise<CoinResult> {
    return this.db.transaction(async (tx) => {
      // Lock the row: two requests at once can never spend the same coins.
      const [a] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).for("update");
      if (!a || a.coins < price) return "poor";
      const coins = a.coins - price;
      await tx.update(accounts).set({ coins, roomUntil: extendRoom(a.roomUntil, nowMs) }).where(eq(accounts.id, accountId));
      await tx.insert(economyLog).values({
        accountId, coinsDelta: -price, chestDelta: 0, coinsAfter: coins, chestAfter: a.chestCoins, reason: "rent_room",
      });
      return "ok";
    });
  }

  async moveChestCoins(accountId: string, amount: number): Promise<CoinResult> {
    if (!Number.isInteger(amount) || amount === 0) return "empty";
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).for("update");
      if (!a) return "poor";
      if (amount > 0 && a.coins < amount) return "poor";
      if (amount < 0 && a.chestCoins < -amount) return "empty";
      const coins = a.coins - amount;
      const chest = a.chestCoins + amount;
      await tx.update(accounts).set({ coins, chestCoins: chest }).where(eq(accounts.id, accountId));
      await tx.insert(economyLog).values({
        accountId, coinsDelta: -amount, chestDelta: amount, coinsAfter: coins, chestAfter: chest, reason: amount > 0 ? "chest_deposit" : "chest_withdraw",
      });
      return "ok";
    });
  }

  async setRestPoint(accountId: string, point: string | null) {
    await this.db.update(accounts).set({ restPoint: point }).where(eq(accounts.id, accountId));
  }

  async spend(accountId: string, amount: number, reason: string): Promise<CoinResult> {
    if (!Number.isInteger(amount) || amount <= 0) return "empty";
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).for("update");
      if (!a || a.coins < amount) return "poor";
      const coins = a.coins - amount;
      await tx.update(accounts).set({ coins }).where(eq(accounts.id, accountId));
      await tx.insert(economyLog).values({ accountId, coinsDelta: -amount, chestDelta: 0, coinsAfter: coins, chestAfter: a.chestCoins, reason });
      return "ok";
    });
  }

  async economyLog(accountId: string): Promise<EconomyEntry[]> {
    return this.db.select().from(economyLog).where(eq(economyLog.accountId, accountId)).orderBy(economyLog.id);
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
  private readonly log: EconomyEntry[] = [];
  private nextLog = 1;

  async createGuest(dob: string) {
    const now = new Date();
    const account: Account = {
      id: randomUUID(), dob, name: "", appearance: "{}", saveCodeHash: null, createdAt: now, lastSeenAt: now,
      coins: STARTING_COINS, chestCoins: 0, roomUntil: null, restPoint: null,
    };
    this.accounts.set(account.id, account);
    this.addLog(account, STARTING_COINS, 0, "starting_purse");
    const token = newToken();
    this.sessions.set(sha256(token), account.id);
    return { account: { ...account }, token };
  }

  // Coin changes happen synchronously here (no await in between), so they are atomic in Node.
  private addLog(a: Account, coinsDelta: number, chestDelta: number, reason: string) {
    this.log.push({
      id: this.nextLog++, accountId: a.id, coinsDelta, chestDelta, coinsAfter: a.coins, chestAfter: a.chestCoins, reason, createdAt: new Date(),
    });
  }

  async wallet(accountId: string) {
    const a = this.accounts.get(accountId);
    return a ? toWallet(a) : { coins: 0, chest: 0, roomUntil: 0, restPoint: null };
  }

  async rentRoom(accountId: string, price: number, nowMs: number): Promise<CoinResult> {
    const a = this.accounts.get(accountId);
    if (!a || a.coins < price) return "poor";
    a.coins -= price;
    a.roomUntil = extendRoom(a.roomUntil, nowMs);
    this.addLog(a, -price, 0, "rent_room");
    return "ok";
  }

  async moveChestCoins(accountId: string, amount: number): Promise<CoinResult> {
    const a = this.accounts.get(accountId);
    if (!Number.isInteger(amount) || amount === 0) return "empty";
    if (!a) return "poor";
    if (amount > 0 && a.coins < amount) return "poor";
    if (amount < 0 && a.chestCoins < -amount) return "empty";
    a.coins -= amount;
    a.chestCoins += amount;
    this.addLog(a, -amount, amount, amount > 0 ? "chest_deposit" : "chest_withdraw");
    return "ok";
  }

  async setRestPoint(accountId: string, point: string | null) {
    const a = this.accounts.get(accountId);
    if (a) a.restPoint = point;
  }

  async spend(accountId: string, amount: number, reason: string): Promise<CoinResult> {
    if (!Number.isInteger(amount) || amount <= 0) return "empty";
    const a = this.accounts.get(accountId);
    if (!a || a.coins < amount) return "poor";
    a.coins -= amount;
    this.addLog(a, -amount, 0, reason);
    return "ok";
  }

  async economyLog(accountId: string) {
    return this.log.filter((e) => e.accountId === accountId).map((e) => ({ ...e }));
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
