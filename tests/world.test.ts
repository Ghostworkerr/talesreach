import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { MOVE_STEP_SECONDS, VIEW_RANGE, WORLD_ROOM, findPath, parseTiledMap, type GameMap } from "@talesreach/shared";
import { matchMaker, type Server } from "@colyseus/core";
import { createGameServer } from "../server/src/app.js";
import { openStore } from "../server/src/db/store.js";
import type { WorldRoom } from "../server/src/rooms/WorldRoom.js";

// Task 2.1: one world room serving the region and the inn; doors move you between them
// (decided by the server), and each client only receives what is near it on its own map.
const PORT = 2601;
let server: Server;
const read = (name: string) => parseTiledMap(JSON.parse(readFileSync(new URL(`../assets/maps/${name}.tmj`, import.meta.url), "utf8")));
const maps: Record<string, GameMap> = { inn: read("inn"), crossroads: read("crossroads") };

beforeAll(async () => {
  const { store } = await openStore("");
  server = createGameServer({ store, rateLimits: { general: 10_000, login: 10_000 } });
  await server.listen(PORT, "127.0.0.1");
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

interface PV {
  x: number;
  y: number;
  map: string;
  ack: number;
}
interface P {
  room: Room;
  seq: number;
  travels: { map: string; x: number; y: number }[];
  rejected: string[];
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const players = (p: P) => (p.room.state as { players: { get(id: string): PV | undefined; size: number } }).players;
const me = (p: P) => players(p).get(p.room.sessionId)!;

async function newPlayer(): Promise<P> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dob: "1990-05-17" }),
  });
  const { token } = (await res.json()) as { token: string };
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(WORLD_ROOM, { token });
  const p: P = { room, seq: 0, travels: [], rejected: [] };
  room.onMessage("travel", (m: P["travels"][number]) => p.travels.push(m));
  room.onMessage("rejected", (m: { reason: string }) => p.rejected.push(m.reason));
  for (const t of ["wallet", "sound", "notice", "dialog", "chat"]) room.onMessage(t, () => undefined);
  await wait(150);
  return p;
}

/** Walk (honestly, one input per tick) along a route on the player's current map. */
async function walkTo(p: P, target: { x: number; y: number }) {
  const startMap = me(p).map;
  const route = findPath(maps[startMap]!.grid, me(p), target, 40_000);
  for (const wp of route) {
    for (let guard = 0; guard < 40; guard++) {
      if (me(p).map !== startMap) return; // went through a door
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

/** Walk into the inn's doorway (and so outside). */
async function goOutside(p: P) {
  const exit = maps.inn!.zones.find((z) => z.type === "door")!;
  await walkTo(p, { x: exit.x + exit.width / 2, y: exit.y + exit.height - 2 });
  // A final push down through the doorway.
  for (let i = 0; i < 12 && me(p).map === "inn"; i++) {
    p.room.send("input", { seq: ++p.seq, x: 0, y: 1 });
    await wait(MOVE_STEP_SECONDS * 1000);
  }
  await wait(200);
}

describe("maps and doors", () => {
  it("new characters arrive inside the inn", async () => {
    const p = await newPlayer();
    expect(me(p).map).toBe("inn");
    await p.room.leave();
  });

  it("walking through the inn's door takes you outside, and the inn door brings you back in", async () => {
    const p = await newPlayer();
    await goOutside(p);
    const front = maps.crossroads!.points.find((pt) => pt.name === "inn_front")!;
    expect(me(p).map).toBe("crossroads");
    expect(p.travels[0]).toMatchObject({ map: "crossroads", x: front.x, y: front.y });

    // Back in: walk into the inn door from the front step.
    const door = maps.crossroads!.zones.find((z) => z.type === "door")!;
    for (let i = 0; i < 20 && me(p).map === "crossroads"; i++) {
      const pos = me(p);
      const dx = door.x + door.width / 2 - pos.x;
      const dy = door.y + door.height / 2 - pos.y;
      const d = Math.hypot(dx, dy) || 1;
      p.room.send("input", { seq: ++p.seq, x: Math.round((dx / d) * 100) / 100, y: Math.round((dy / d) * 100) / 100 });
      await wait(MOVE_STEP_SECONDS * 1000);
    }
    await wait(200);
    expect(me(p).map).toBe("inn");
    const entry = maps.inn!.points.find((pt) => pt.name === "inn_entry")!;
    expect(p.travels[1]).toMatchObject({ map: "inn", x: entry.x, y: entry.y });
    await p.room.leave();
  }, 30_000);

  it("abuse: a client cannot choose its map or travel by itself", async () => {
    const p = await newPlayer();
    p.room.send("travel", { map: "crossroads", x: 10, y: 10 });
    p.room.send("input", { seq: ++p.seq, x: 0, y: 1, map: "crossroads" });
    await wait(250);
    expect(p.rejected).toEqual(expect.arrayContaining([expect.stringContaining("unknown message type"), "invalid payload"]));
    expect(me(p).map).toBe("inn");
    expect(p.travels).toHaveLength(0);
    await p.room.leave();
  });

  it("local chat does not reach someone on another map, however close the numbers are", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await goOutside(a);
    const heard: string[] = [];
    b.room.onMessage("chat", (m: { text: string }) => heard.push(m.text));
    a.room.send("chat", { channel: "local", text: "hello inside?" });
    await wait(250);
    expect(heard).toHaveLength(0);
    await a.room.leave();
    await b.room.leave();
  }, 30_000);
});

describe("interest management", () => {
  it("you don't receive players on another map", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    expect(players(b).get(a.room.sessionId)).toBeTruthy(); // both in the inn
    await goOutside(a);
    await wait(400);
    expect(players(b).get(a.room.sessionId)).toBeUndefined();
    expect(players(a).get(b.room.sessionId)).toBeUndefined();
    // ...and NPCs stay in the inn.
    expect((a.room.state as { npcs: { size: number } }).npcs.size).toBe(0);
    expect((b.room.state as { npcs: { size: number } }).npcs.size).toBeGreaterThan(0);
    await a.room.leave();
    await b.room.leave();
  }, 30_000);

  it("you don't receive players far away on the same map, and see them again when they come near", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await goOutside(a);
    await goOutside(b);
    await wait(400);
    expect(players(b).get(a.room.sessionId)).toBeTruthy();
    // Move `a` far away on the server (a test shortcut for a long walk).
    const room = matchMaker.getLocalRoomById(a.room.roomId) as unknown as WorldRoom;
    const pa = room.state.players.get(a.room.sessionId)!;
    const home = { x: pa.x, y: pa.y };
    pa.x = home.x + VIEW_RANGE + 300;
    await wait(500);
    expect(players(b).get(a.room.sessionId)).toBeUndefined();
    expect(me(a)).toBeTruthy(); // you always see yourself
    pa.x = home.x + 20;
    await wait(500);
    expect(players(b).get(a.room.sessionId)?.x).toBeCloseTo(home.x + 20, 0);
    await a.room.leave();
    await b.room.leave();
  }, 40_000);
});

describe("weather (task 2.2)", () => {
  it("everyone gets the server's weather in the room state", async () => {
    const p = await newPlayer();
    const st = p.room.state as { weather: string; weatherSince: number };
    expect(["clear", "cloudy", "rain", "storm", "fog", "snow"]).toContain(st.weather);
    expect(st.weatherSince).toBeGreaterThan(0);
    const room = matchMaker.getLocalRoomById(p.room.roomId) as unknown as WorldRoom;
    room.weather.set("rain");
    room.publishWeather();
    await wait(300);
    expect(st.weather).toBe("rain");
    await p.room.leave();
  });

  it("abuse: a client cannot change the weather", async () => {
    const p = await newPlayer();
    const room = matchMaker.getLocalRoomById(p.room.roomId) as unknown as WorldRoom;
    room.weather.set("clear");
    room.publishWeather();
    for (const type of ["weather", "setWeather"]) p.room.send(type, { weather: "storm" });
    await wait(300);
    expect(p.rejected.filter((r) => r.startsWith("unknown message type")).length).toBe(2);
    expect((p.room.state as { weather: string }).weather).toBe("clear");
    await p.room.leave();
  });

  it("fog really shortens sight outdoors: someone you could see in clear weather is hidden in fog", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await goOutside(a);
    await goOutside(b);
    const room = matchMaker.getLocalRoomById(a.room.roomId) as unknown as WorldRoom;
    room.weather.set("clear");
    const pa = room.state.players.get(a.room.sessionId)!;
    const pb = room.state.players.get(b.room.sessionId)!;
    pa.x = pb.x + VIEW_RANGE * 0.8;
    pa.y = pb.y;
    await wait(500);
    expect(players(b).get(a.room.sessionId)).toBeTruthy();
    room.weather.set("fog");
    await wait(500);
    expect(players(b).get(a.room.sessionId)).toBeUndefined();
    room.weather.set("clear");
    await wait(500);
    expect(players(b).get(a.room.sessionId)).toBeTruthy();
    await a.room.leave();
    await b.room.leave();
  }, 40_000);
});
