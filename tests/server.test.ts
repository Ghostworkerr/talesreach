import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { MAX_MESSAGE_BYTES, WORLD_ROOM } from "@talesreach/shared";
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

describe("abuse cases", () => {
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
