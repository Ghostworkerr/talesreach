import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { MAX_MESSAGE_BYTES, PLAYER_SPEED, WORLD_ROOM } from "@talesreach/shared";
import { createGameServer } from "../server/src/app.js";

const PORT = 2599;
const server = createGameServer();

beforeAll(async () => {
  await server.listen(PORT, "127.0.0.1");
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const join = () => new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(WORLD_ROOM);

function nextMessage<T = unknown>(room: Room, type: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${type}" within ${timeoutMs}ms`)), timeoutMs);
    room.onMessage(type, (msg: T) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
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
    await new Promise((r) => setTimeout(r, 150));
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

interface P {
  x: number;
  y: number;
}
interface S {
  players: { get(id: string): P | undefined; size: number };
}
const playerIn = (room: Room, id: string) => (room.state as S).players.get(id);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("two players in one room", () => {
  it("each sees the other, and sees the other move", async () => {
    const a = await join();
    const b = await join();
    await wait(150);
    expect((a.state as S).players.size).toBe(2);
    const startX = playerIn(b, a.sessionId)!.x;

    a.send("input", { x: 1, y: 0 });
    await wait(500);
    a.send("input", { x: 0, y: 0 });
    await wait(150);

    const movedX = playerIn(b, a.sessionId)!.x;
    expect(movedX).toBeGreaterThan(startX + 20);

    await a.leave();
    await wait(150);
    expect(playerIn(b, a.sessionId)).toBeUndefined();
    await b.leave();
  });
});

describe("abuse cases", () => {
  it("refuses an input that tries to send a position (teleport attempt)", async () => {
    const room = await join();
    await wait(100);
    const before = { ...playerIn(room, room.sessionId)! };
    const rejected = nextMessage<{ reason: string }>(room, "rejected");
    room.send("input", { x: 900, y: 600 });
    expect((await rejected).reason).toBe("invalid payload");
    await wait(150);
    expect(playerIn(room, room.sessionId)).toMatchObject(before);
    await room.leave();
  });

  it("refuses inputs with extra fields or garbage values", async () => {
    const room = await join();
    for (const bad of [{ x: 1, y: 0, speed: 50 }, { x: "1", y: 0 }, { x: Number.NaN, y: 0 }, "go right"]) {
      const rejected = nextMessage<{ reason: string }>(room, "rejected");
      room.send("input", bad);
      expect((await rejected).reason).toBe("invalid payload");
    }
    await room.leave();
  });

  it("does not let a client walk faster than walking speed", async () => {
    const room = await join();
    await wait(100);
    const start = { ...playerIn(room, room.sessionId)! };
    room.send("input", { x: 1, y: 1 }); // diagonal must not be faster
    await wait(1000);
    room.send("input", { x: 0, y: 0 });
    await wait(150);
    const end = playerIn(room, room.sessionId)!;
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    // ~1.0–1.15 s of walking at most, allowing for timing jitter.
    expect(dist).toBeLessThanOrEqual(PLAYER_SPEED * 1.3);
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
    room.send("ping", { n: 1, junk: "x".repeat(MAX_MESSAGE_BYTES * 4) });
    expect(typeof (await left)).toBe("number");
  });

  it("disconnects a client that floods messages", async () => {
    const room = await join();
    room.onMessage("pong", () => undefined);
    room.onMessage("rejected", () => undefined);
    const left = new Promise<number>((resolve) => room.onLeave((code) => resolve(code)));
    for (let i = 0; i < 200; i++) room.send("ping", { n: i });
    expect(typeof (await left)).toBe("number");
  });
});
