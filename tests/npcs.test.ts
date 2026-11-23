import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORLD_DAY_MS, WORLD_EPOCH_MS, isBlockedTile, parseTiledMap } from "@talesreach/shared";
import { NPC_DEFS, NPC_SPEED, NpcBrain, routineAt } from "../server/src/world/npcs.js";
import { bardDialog, innkeeperDialog, serverDialog } from "../server/src/world/dialogue.js";
import { worldTime } from "@talesreach/shared";

const map = parseTiledMap(JSON.parse(readFileSync(new URL("../assets/maps/crossroads.tmj", import.meta.url), "utf8")));
const def = (id: string) => NPC_DEFS.find((d) => d.id === id)!;
/** Server time at a given world hour (day 10). */
const at = (hour: number) => WORLD_EPOCH_MS + 9 * WORLD_DAY_MS + (hour / 24) * WORLD_DAY_MS;

describe("NPC routines", () => {
  it("every hour of the day has a routine, and every spot exists on open floor", () => {
    for (const d of NPC_DEFS) {
      for (let h = 0; h < 24; h++) expect(routineAt(d, h)).toBeTruthy();
      for (const r of d.routines) {
        for (const spot of r.spots) {
          const p = map.points.find((pt) => pt.name === spot);
          expect(p, `${d.id}: ${spot}`).toBeTruthy();
          expect(isBlockedTile(map.grid, Math.floor(p!.x / 16), Math.floor(p!.y / 16)), spot).toBe(false);
        }
      }
    }
  });

  it("follows the clock: the bard performs in the evening, sleeps late, wanders by day", () => {
    expect(routineAt(def("bard"), 20).activity).toBe("performing");
    expect(routineAt(def("bard"), 1).activity).toBe("performing");
    expect(routineAt(def("bard"), 4).activity).toBe("sleeping");
    expect(routineAt(def("bard"), 12).activity).toBe("wandering");
    expect(routineAt(def("innkeeper"), 23).activity).toBe("resting");
    expect(routineAt(def("server"), 9).activity).toBe("serving");
  });

  it("walks only on open floor, never faster than its walking speed, and reaches its spot", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const bard = new NpcBrain(def("bard"), map, rand);
    // Midday: the bard heads out to the courtyard.
    let prev = { x: bard.x, y: bard.y };
    let maxStep = 0;
    for (let i = 0; i < 20 * 120; i++) {
      bard.update(0.05, at(12) + i * 50);
      maxStep = Math.max(maxStep, Math.hypot(bard.x - prev.x, bard.y - prev.y));
      expect(isBlockedTile(map.grid, Math.floor(bard.x / 16), Math.floor(bard.y / 16))).toBe(false);
      prev = { x: bard.x, y: bard.y };
    }
    expect(maxStep).toBeLessThanOrEqual(NPC_SPEED * 0.05 + 1e-6);
    expect(bard.activity).toBe("wandering");
    expect(bard.y).toBeGreaterThan(17 * 16); // out of the inn, in the courtyard
    // Evening: back on stage.
    for (let i = 0; i < 20 * 120; i++) bard.update(0.05, at(19) + i * 50);
    expect(bard.activity).toBe("performing");
    const stage = map.points.find((p) => p.name === "bard_stage")!;
    expect(Math.hypot(bard.x - stage.x, bard.y - stage.y)).toBeLessThan(1);
  });
});

describe("NPC dialogue", () => {
  const ctx = (over: Partial<Parameters<typeof innkeeperDialog>[1]> = {}) => ({
    playerName: "Wren",
    time: worldTime(at(12)),
    activity: "working" as const,
    talks: 0,
    rented: false,
    ...over,
  });

  it("the innkeeper greets you by name and offers a room", () => {
    const d = innkeeperDialog("Marta", ctx());
    expect(d.text).toContain("Wren");
    expect(d.options.map((o) => o.id)).toContain("rentRoom");
    expect(innkeeperDialog("Marta", ctx({ rented: true })).options[0]!.label).toMatch(/another night/);
  });

  it("the bard only takes requests while performing", () => {
    expect(bardDialog("Lark", ctx({ activity: "performing" })).options.some((o) => o.id.startsWith("song:"))).toBe(true);
    expect(bardDialog("Lark", ctx({ activity: "wandering" })).options.some((o) => o.id.startsWith("song:"))).toBe(false);
    expect(bardDialog("Lark", ctx({ activity: "sleeping" })).text).toMatch(/Zzz/);
  });

  it("the server shares different rumours as you keep chatting", () => {
    const a = serverDialog("Tobin", ctx({ activity: "serving", talks: 1 })).text;
    const b = serverDialog("Tobin", ctx({ activity: "serving", talks: 2 })).text;
    expect(a).not.toBe(b);
    expect(serverDialog("Tobin", ctx({ activity: "resting" })).options).toHaveLength(1);
  });
});

describe("tipping the bard", () => {
  it("costs a coin, changes the song for everyone, and only works while she performs", async () => {
    const { MemoryAccountStore } = await import("../server/src/db/store.js");
    const { setAccountStore } = await import("../server/src/services.js");
    const { Npcs } = await import("../server/src/rooms/npcRoom.js");
    const { WorldState } = await import("../server/src/rooms/WorldState.js");
    const store = new MemoryAccountStore();
    setAccountStore(store);
    const { account } = await store.createGuest("1990-01-01");
    const state = new WorldState();
    const sent: { type: string; msg: unknown }[] = [];
    const broadcasts: unknown[] = [];
    const rejected: string[] = [];
    let myPos = { x: 0, y: 0 };
    const npcs = new Npcs({
      map,
      state,
      position: () => myPos,
      account: () => account,
      isRented: async () => false,
      reject: (_c, reason) => rejected.push(reason),
      broadcast: (_t, m) => broadcasts.push(m),
    });
    const client = { sessionId: "s1", send: (type: string, msg: unknown) => sent.push({ type, msg }) } as unknown as Parameters<typeof npcs.requestSong>[0];
    const bard = (npcs as unknown as { brains: Map<string, { x: number; y: number; activity: string }> }).brains.get("bard")!;

    // Too far away.
    await npcs.requestSong(client, { song: 1 });
    expect(rejected).toContain("too far");
    // Close, but she isn't performing.
    myPos = { x: bard.x + 10, y: bard.y };
    bard.activity = "wandering";
    await npcs.requestSong(client, { song: 1 });
    expect(rejected).toContain("not performing");
    // Performing: pay a coin, song changes for everyone.
    bard.activity = "performing";
    await npcs.requestSong(client, { song: 1 });
    expect(state.bardSong).toBe(1);
    expect(state.bardSongSeq).toBe(1);
    expect(broadcasts).toHaveLength(1);
    expect((await store.wallet(account.id)).coins).toBe(19);
    expect((await store.economyLog(account.id)).at(-1)?.reason).toBe("bard_song");
    // Broke: no more songs.
    await store.spend(account.id, 19, "test");
    await npcs.requestSong(client, { song: 0 });
    expect(rejected).toContain("not enough coins");
    expect(state.bardSong).toBe(1);
  });
});
