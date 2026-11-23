import { describe, expect, it } from "vitest";
import { openStore, type AccountStore } from "../server/src/db/store.js";

/**
 * The same contract for both account stores: plain memory (used live until a
 * database is connected) and SQL (checked on the in-memory PGlite Postgres).
 */
const engines = [
  ["memory", () => openStore("", { engine: "memory" })],
  ["sql (pglite)", () => openStore("", { engine: "pglite" })],
] as const;

describe.each(engines)("account store: %s", (_name, open) => {
  const store = async (): Promise<AccountStore> => (await open()).store;

  it("guests, tokens and save codes", async () => {
    const s = await store();
    const { account, token } = await s.createGuest("1990-01-02");
    expect(account.dob).toBe("1990-01-02");
    expect((await s.byToken(token))?.id).toBe(account.id);
    expect(await s.byToken("nope-nope-nope-nope-nope")).toBeUndefined();
    const code = await s.rotateSaveCode(account.id);
    const login = await s.loginWithSaveCode(code);
    expect(login?.account.id).toBe(account.id);
    expect((await s.byToken(login!.token))?.id).toBe(account.id);
    const newer = await s.rotateSaveCode(account.id);
    expect(await s.loginWithSaveCode(code)).toBeUndefined();
    expect((await s.loginWithSaveCode(newer))?.account.id).toBe(account.id);
  });

  it("names are unique ignoring capitals", async () => {
    const s = await store();
    const a = (await s.createGuest("1990-01-02")).account;
    const b = (await s.createGuest("1990-01-02")).account;
    expect(await s.setProfile(a.id, "Corin Vale", "{}")).toBe(true);
    expect(await s.setProfile(b.id, "CORIN VALE", "{}")).toBe(false);
    expect(await s.setProfile(a.id, "Corin Vale", '{"hat":1}')).toBe(true);
    expect(await s.setProfile(b.id, "Corin Ash", "{}")).toBe(true);
  });

  it("blocks work both ways and can be undone", async () => {
    const s = await store();
    const a = (await s.createGuest("1990-01-02")).account.id;
    const b = (await s.createGuest("1990-01-02")).account.id;
    const c = (await s.createGuest("1990-01-02")).account.id;
    await s.block(a, b);
    await s.block(a, b); // twice is fine
    await s.block(c, a);
    expect([...(await s.blockedEitherWay(a))].sort()).toEqual([b, c].sort());
    expect([...(await s.blockedEitherWay(b))]).toEqual([a]);
    await s.unblock(a, b);
    expect([...(await s.blockedEitherWay(a))]).toEqual([c]);
  });

  it("reports: newest first, filtered by status", async () => {
    const s = await store();
    const r1 = await s.addReport({ reporterId: "x", reportedId: "y", reportedName: "Y", reason: "other", note: "one", evidence: [] });
    const r2 = await s.addReport({ reporterId: "x", reportedId: "z", reportedName: "Z", reason: "bullying", note: "two", evidence: [{ who: "reported", lines: [] }] });
    const open = await s.listReports("open");
    expect(open.map((r) => r.id)).toEqual([r2.id, r1.id].filter((id) => open.some((r) => r.id === id)));
    expect(JSON.parse(open.find((r) => r.id === r2.id)!.evidence)).toEqual([{ who: "reported", lines: [] }]);
    await s.setReportStatus(r1.id, "resolved");
    expect((await s.listReports("open")).some((r) => r.id === r1.id)).toBe(false);
    expect((await s.listReports("resolved")).some((r) => r.id === r1.id)).toBe(true);
  });
});

describe.each(engines)("economy: %s", (_name, open) => {
  const store = async (): Promise<AccountStore> => (await open()).store;
  const DAY = 2 * 60 * 60 * 1000;

  it("starting purse, renting and the chest are all logged and add up", async () => {
    const s = await store();
    const { account } = await s.createGuest("1990-01-02");
    expect(await s.wallet(account.id)).toMatchObject({ coins: 20, chest: 0, roomUntil: 0 });
    const now = Date.now();
    expect(await s.rentRoom(account.id, 5, now)).toBe("ok");
    expect((await s.wallet(account.id)).roomUntil).toBe(now + DAY);
    expect(await s.rentRoom(account.id, 5, now)).toBe("ok"); // extends from the end of the current rental
    expect((await s.wallet(account.id)).roomUntil).toBe(now + 2 * DAY);
    expect(await s.moveChestCoins(account.id, 4)).toBe("ok");
    expect(await s.moveChestCoins(account.id, -10)).toBe("empty");
    expect(await s.moveChestCoins(account.id, 7)).toBe("poor");
    expect(await s.moveChestCoins(account.id, 0)).toBe("empty");
    expect(await s.wallet(account.id)).toMatchObject({ coins: 6, chest: 4 });
    const log = await s.economyLog(account.id);
    expect(log.map((e) => e.reason)).toEqual(["starting_purse", "rent_room", "rent_room", "chest_deposit"]);
    // The log adds up to the balance.
    expect(log.reduce((sum, e) => sum + e.coinsDelta, 0)).toBe(6);
    expect(log.reduce((sum, e) => sum + e.chestDelta, 0)).toBe(4);
    expect(log.at(-1)).toMatchObject({ coinsAfter: 6, chestAfter: 4 });
  });

  it("two purchases at the same moment can't spend the same coins", async () => {
    const s = await store();
    const { account } = await s.createGuest("1990-01-02");
    // 20 coins, rooms cost 15: only one of two simultaneous rentals may succeed.
    const results = await Promise.all([s.rentRoom(account.id, 15, Date.now()), s.rentRoom(account.id, 15, Date.now())]);
    expect(results.sort()).toEqual(["ok", "poor"]);
    expect((await s.wallet(account.id)).coins).toBe(5);
    const moves = await Promise.all([s.moveChestCoins(account.id, 5), s.moveChestCoins(account.id, 5)]);
    expect(moves.sort()).toEqual(["ok", "poor"]);
    expect(await s.wallet(account.id)).toMatchObject({ coins: 0, chest: 5 });
  });

  it("rest points are remembered", async () => {
    const s = await store();
    const { account } = await s.createGuest("1990-01-02");
    await s.setRestPoint(account.id, "room_a");
    expect((await s.wallet(account.id)).restPoint).toBe("room_a");
  });
});
