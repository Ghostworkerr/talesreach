import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { DEFAULT_APPEARANCE, MOVE_STEP_SECONDS, ROOM_PRICE, STARTING_COINS, WORLD_DAY_MS, WORLD_ROOM, findPath, parseTiledMap, type Wallet } from "@talesreach/shared";
import { createGameServer } from "../server/src/app.js";
import { openStore, type AccountStore } from "../server/src/db/store.js";

const PORT = 2595;
const BASE = `http://127.0.0.1:${PORT}`;
const map = parseTiledMap(JSON.parse(readFileSync(new URL("../assets/maps/crossroads.tmj", import.meta.url), "utf8")));
const point = (name: string) => map.points.find((p) => p.name === name)!;
let server: Server;
let store: AccountStore;

beforeAll(async () => {
  store = (await openStore("")).store;
  server = createGameServer({ store, rateLimits: { general: 10_000, login: 10_000 } });
  await server.listen(PORT, "127.0.0.1");
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface P {
  room: Room;
  token: string;
  inbox: { type: string; msg: Record<string, unknown> }[];
  seq: number;
}

async function newPlayer(token?: string): Promise<P> {
  if (!token) {
    const res = await fetch(`${BASE}/api/guest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dob: "1990-01-01" }) });
    token = ((await res.json()) as { token: string }).token;
    await fetch(`${BASE}/api/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `Inn Guest ${String.fromCharCode(97 + Math.floor(Math.random() * 26))}${String.fromCharCode(97 + Math.floor(Math.random() * 26))}${String.fromCharCode(97 + Math.floor(Math.random() * 26))}`, appearance: DEFAULT_APPEARANCE }),
    });
  }
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(WORLD_ROOM, { token });
  const inbox: P["inbox"] = [];
  for (const t of ["wallet", "dialog", "notice", "rejected", "sound", "chat", "party"]) room.onMessage(t, (msg: Record<string, unknown>) => inbox.push({ type: t, msg }));
  await wait(200);
  return { room, token, inbox, seq: 0 };
}
const me = (p: P) => (p.room.state as { players: { get(id: string): { x: number; y: number } } }).players.get(p.room.sessionId);
const last = (p: P, type: string) => p.inbox.filter((m) => m.type === type).at(-1)?.msg;
const rejections = (p: P) => p.inbox.filter((m) => m.type === "rejected").map((m) => m.msg.reason);

/** Walk along a route (like tap-to-move), one input per server tick. */
async function walkTo(p: P, target: { x: number; y: number }) {
  const route = findPath(map.grid, me(p), target);
  for (const wp of route) {
    for (let guard = 0; guard < 40; guard++) {
      const pos = me(p);
      const dx = wp.x - pos.x;
      const dy = wp.y - pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) break;
      p.room.send("input", { seq: ++p.seq, x: Math.round((dx / d) * 100) / 100, y: Math.round((dy / d) * 100) / 100 });
      await wait(MOVE_STEP_SECONDS * 1000);
    }
  }
  await wait(200);
}

describe("the inn", () => {
  it("you start with a few coins, and the innkeeper rents you a room", async () => {
    const p = await newPlayer();
    expect(last(p, "wallet")).toMatchObject({ coins: STARTING_COINS, chest: 0, roomUntil: 0 });

    // Too far away to talk.
    p.room.send("interact", { target: "innkeeper" });
    p.room.send("rentRoom", {});
    await wait(200);
    expect(rejections(p).filter((r) => r === "too far").length).toBe(2);

    // Walk up to the bar.
    const keeper = point("innkeeper");
    await walkTo(p, { x: keeper.x, y: keeper.y + 32 });
    p.room.send("interact", { target: "innkeeper" });
    await wait(200);
    const dialog = last(p, "dialog") as { speaker: string; options: { id: string }[] };
    expect(dialog.speaker).toBe("Innkeeper");
    expect(dialog.options.map((o) => o.id)).toContain("rentRoom");

    const before = Date.now();
    p.room.send("rentRoom", {});
    await wait(300);
    const w = last(p, "wallet") as unknown as Wallet;
    expect(w.coins).toBe(STARTING_COINS - ROOM_PRICE);
    expect(w.roomUntil).toBeGreaterThanOrEqual(before + WORLD_DAY_MS);

    // Spend down to zero, then the innkeeper says no.
    for (let i = 0; i < 4; i++) {
      p.room.send("rentRoom", {});
      await wait(150);
    }
    expect((last(p, "wallet") as unknown as Wallet).coins).toBe(0);
    expect(rejections(p)).toContain("not enough coins");
    await p.room.leave();
  });

  it("rest in your bed, use the chest, and wake up there next time", async () => {
    const p = await newPlayer();
    const keeper = point("innkeeper");
    await walkTo(p, { x: keeper.x, y: keeper.y + 32 });
    p.room.send("rentRoom", {});
    await wait(200);

    const bed = point("room_a");
    await walkTo(p, bed);
    p.room.send("interact", { target: "room_a" });
    await wait(200);
    expect((last(p, "dialog") as { speaker: string }).speaker).toBe("Your room");
    p.room.send("rest", { point: "room_a" });
    p.room.send("chest", { amount: 6 });
    await wait(300);
    expect(last(p, "wallet")).toMatchObject({ coins: 9, chest: 6, restPoint: "room_a" });
    p.room.send("chest", { amount: -10 });
    await wait(200);
    expect(rejections(p)).toContain("not enough in the chest");
    p.room.send("chest", { amount: -2 });
    await wait(200);
    expect(last(p, "wallet")).toMatchObject({ coins: 11, chest: 4 });

    // Come back later: you wake in your bed.
    await p.room.leave();
    const again = await newPlayer(p.token);
    expect(Math.hypot(me(again).x - bed.x, me(again).y - bed.y)).toBeLessThan(1);
    await again.room.leave();
  });

  it("refuses room actions without a room, from afar, or with bad values", async () => {
    const p = await newPlayer();
    const bed = point("room_b");
    await walkTo(p, bed);
    p.room.send("interact", { target: "room_b" });
    p.room.send("rest", { point: "room_b" });
    p.room.send("chest", { amount: 5 });
    await wait(300);
    expect((last(p, "dialog") as { speaker: string }).speaker).toBe("Inn room"); // not yours
    expect(rejections(p).filter((r) => r === "no room").length).toBe(2);
    for (const bad of [{ amount: 0 }, { amount: 1.5 }, { amount: 10_000_000 }, { amount: "5" }, {}, { amount: 5, to: "friend" }]) p.room.send("chest", bad);
    for (const bad of [{ target: "INNKEEPER" }, { target: "../etc" }, { target: "" }]) p.room.send("interact", bad);
    p.room.send("interact", { target: "dragon" }); // not a thing on this map
    await wait(300);
    expect(rejections(p).filter((r) => r === "invalid payload").length).toBe(9);
    expect(rejections(p)).toContain("too far");
    // Nothing above changed any coins.
    expect(await store.economyLog((await store.byToken(p.token))!.id)).toHaveLength(1);
    await p.room.leave();
  });
});
