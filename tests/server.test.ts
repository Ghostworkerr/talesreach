import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import {
  MAX_MESSAGE_BYTES,
  MAX_QUEUED_INPUTS,
  MOVE_STEP_SECONDS,
  PLAYER_SPEED,
  TICK_RATE,
  WORLD_ROOM,
} from "@talesreach/shared";
import type { Server } from "@colyseus/core";
import { createGameServer } from "../server/src/app.js";
import { openStore } from "../server/src/db/store.js";

const PORT = 2599;
let server: Server;

beforeAll(async () => {
  const { store } = await openStore("");
  // This file makes many test players quickly, so the per-IP limits are raised here.
  server = createGameServer({ store, rateLimits: { general: 10_000, login: 10_000 } });
  await server.listen(PORT, "127.0.0.1");
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

/** Make a guest account (adult) and join the world with its token. */
async function join() {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dob: "1990-05-17" }),
  });
  const { token } = (await res.json()) as { token: string };
  return new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(WORLD_ROOM, { token });
}

function nextMessage<T = unknown>(room: Room, type: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${type}" within ${timeoutMs}ms`)), timeoutMs);
    room.onMessage(type, (msg: T) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

interface P {
  x: number;
  y: number;
  ack: number;
}
interface S {
  players: { get(id: string): P | undefined; size: number };
}
const playerIn = (room: Room, id: string) => (room.state as S).players.get(id);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Distance moved by one input at full speed. */
const STEP = PLAYER_SPEED * MOVE_STEP_SECONDS;

/** Send `count` inputs one tick apart, like an honest client. */
async function walk(room: Room, dir: { x: number; y: number }, count: number, firstSeq = 1) {
  for (let i = 0; i < count; i++) {
    room.send("input", { seq: firstSeq + i, ...dir });
    await wait(MOVE_STEP_SECONDS * 1000);
  }
}

describe("game server", () => {
  it("answers the health check", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(await res.json()).toMatchObject({ ok: true, game: "Talesreach" });
  });

  it("lets two clients join the world room and counts them", async () => {
    const a = await join();
    const b = await join();
    expect(a.roomId).toBe(b.roomId);
    await wait(150);
    expect((a.state as { playerCount: number }).playerCount).toBe(2);
    await a.leave();
    await b.leave();
  });

  it("echoes a valid ping", async () => {
    const room = await join();
    room.onMessage("rejected", () => undefined);
    const pong = nextMessage<{ n: number }>(room, "pong");
    room.send("ping", { n: 7 });
    expect(await pong).toEqual({ n: 7 });
    await room.leave();
  });
});

describe("two players in one room", () => {
  it("each sees the other, and sees the other move", async () => {
    const a = await join();
    const b = await join();
    await wait(150);
    expect((a.state as S).players.size).toBe(2);
    const startX = playerIn(b, a.sessionId)!.x;

    await walk(a, { x: 1, y: 0 }, 10);
    await wait(200);

    const seen = playerIn(b, a.sessionId)!;
    expect(seen.x - startX).toBeCloseTo(10 * STEP, 0);
    // The server tells the walker which inputs it has applied.
    expect(playerIn(a, a.sessionId)!.ack).toBe(10);

    await a.leave();
    await wait(150);
    expect(playerIn(b, a.sessionId)).toBeUndefined();
    await b.leave();
  });
});

describe("abuse cases", () => {
  it("refuses an input that tries to send a position (fake teleport)", async () => {
    const room = await join();
    await wait(100);
    const before = { ...playerIn(room, room.sessionId)! };
    const rejected = nextMessage<{ reason: string }>(room, "rejected");
    room.send("input", { seq: 1, x: 900, y: 600 });
    expect((await rejected).reason).toBe("invalid payload");
    await wait(150);
    expect(playerIn(room, room.sessionId)).toMatchObject({ x: before.x, y: before.y });
    await room.leave();
  });

  it("refuses inputs with extra fields, missing fields or garbage values", async () => {
    const room = await join();
    for (const bad of [
      { seq: 1, x: 1, y: 0, speed: 50 },
      { seq: 1, x: 1, y: 0, teleportTo: { x: 0, y: 0 } },
      { x: 1, y: 0 },
      { seq: 1, x: "1", y: 0 },
      { seq: 1, x: Number.NaN, y: 0 },
      { seq: -3, x: 1, y: 0 },
      { seq: 2 ** 40, x: 1, y: 0 },
      "go right",
    ]) {
      const rejected = nextMessage<{ reason: string }>(room, "rejected");
      room.send("input", bad);
      expect((await rejected).reason).toBe("invalid payload");
    }
    await room.leave();
  });

  it("speed hack: a burst of inputs cannot move a player faster", async () => {
    const room = await join();
    await wait(100);
    const start = { ...playerIn(room, room.sessionId)! };
    // 20 inputs at once (under the flood limit); an honest client sends 1 per tick.
    for (let i = 1; i <= 20; i++) room.send("input", { seq: i, x: 1, y: 1 });
    await wait(600);
    const end = playerIn(room, room.sessionId)!;
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    // Only the queued few may be applied; the rest are dropped. Diagonal is never faster.
    expect(dist).toBeLessThanOrEqual(MAX_QUEUED_INPUTS * STEP + 0.01);
    await room.leave();
  });

  it("speed hack: sending faster than the tick rate for a second gains nothing", async () => {
    const room = await join();
    await wait(100);
    const start = { ...playerIn(room, room.sessionId)! };
    const sent = 28;
    for (let i = 1; i <= sent; i++) {
      room.send("input", { seq: i, x: 1, y: 0 });
      await wait(1000 / sent);
    }
    await wait(400);
    const end = playerIn(room, room.sessionId)!;
    // Roughly one second of ticks plus the small queue, never all 28.
    expect(end.x - start.x).toBeLessThanOrEqual((TICK_RATE * 1.15 + MAX_QUEUED_INPUTS) * STEP);
    await room.leave();
  });

  it("walls are solid on the server: walking into one stops you", async () => {
    const room = await join();
    await wait(100);
    for (let i = 1; i <= 40; i++) {
      room.send("input", { seq: i, x: 0, y: -1 });
      await wait(MOVE_STEP_SECONDS * 1000);
    }
    await wait(200);
    const me = playerIn(room, room.sessionId)!;
    // The inn's north wall face ends at row 3 (y = 64); feet can't cross it.
    expect(me.y).toBeGreaterThanOrEqual(64 + 3);
    expect(me.ack).toBe(40);
    await room.leave();
  });

  it("ignores replayed or old inputs", async () => {
    const room = await join();
    await walk(room, { x: 1, y: 0 }, 3, 5);
    await wait(150);
    const before = { ...playerIn(room, room.sessionId)! };
    const rejected = nextMessage<{ reason: string }>(room, "rejected");
    room.send("input", { seq: 6, x: 1, y: 0 }); // replay
    expect((await rejected).reason).toBe("old input");
    await wait(150);
    expect(playerIn(room, room.sessionId)!.x).toBe(before.x);
    await room.leave();
  });

  it("refuses a ping with a garbage payload", async () => {
    const room = await join();
    room.onMessage("pong", () => {
      throw new Error("server should not answer garbage");
    });
    const rejected = nextMessage<{ reason: string }>(room, "rejected");
    room.send("ping", { n: "lots", hack: true });
    expect((await rejected).reason).toBe("invalid payload");
    await room.leave();
  });

  it("refuses unknown message types", async () => {
    const room = await join();
    const rejected = nextMessage<{ reason: string }>(room, "rejected");
    room.send("giveMeGold", { amount: 999999 });
    expect((await rejected).reason).toMatch(/unknown message type/);
    await room.leave();
  });

  it("disconnects a client that sends an oversized message", async () => {
    const room = await join();
    room.onMessage("rejected", () => undefined);
    const left = new Promise<number>((resolve) => room.onLeave((code) => resolve(code)));
    room.send("input", { seq: 1, x: 1, y: 0, junk: "x".repeat(MAX_MESSAGE_BYTES * 4) });
    expect(typeof (await left)).toBe("number");
  });

  it("disconnects a client that floods messages", async () => {
    const room = await join();
    room.onMessage("pong", () => undefined);
    room.onMessage("rejected", () => undefined);
    const left = new Promise<number>((resolve) => room.onLeave((code) => resolve(code)));
    for (let i = 1; i <= 200; i++) room.send("input", { seq: i, x: 1, y: 0 });
    expect(typeof (await left)).toBe("number");
  });
});
