import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { DEFAULT_APPEARANCE, WORLD_ROOM, appearanceFrames, checkName, containsBlockedWord, randomAppearance } from "@talesreach/shared";
import { createGameServer } from "../server/src/app.js";
import { openStore } from "../server/src/db/store.js";

const PORT = 2597;
const BASE = `http://127.0.0.1:${PORT}`;
let server: Server;

beforeAll(async () => {
  const { store } = await openStore("");
  server = createGameServer({ store, rateLimits: { general: 10_000, login: 10_000 } });
  await server.listen(PORT, "127.0.0.1");
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

interface Reply {
  token: string;
  error: string;
  name: string;
  appearance: typeof DEFAULT_APPEARANCE;
}
const call = async (path: string, body?: unknown, token?: string) => {
  const res = await fetch(`${BASE}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Reply };
};
const newGuest = async () => (await call("/guest", { dob: "1992-03-04" })).body.token;

describe("text filter", () => {
  it("catches rude words, leetspeak and spaced-out tricks", () => {
    for (const bad of ["fuck", "F u c k", "fuuuuck", "sh1t", "$hit", "you are a b!tch", "s e x", "nice tits"]) {
      expect(containsBlockedWord(bad), bad).toBe(true);
    }
  });

  it("allows innocent words that contain short rude words", () => {
    for (const ok of ["Essex", "Sussex", "Dickens", "Cockburn", "classic", "assassin", "therapist", "cocktail", "Hello traveller"]) {
      expect(containsBlockedWord(ok), ok).toBe(false);
    }
  });

  it("name rules", () => {
    expect(checkName("  Wren   Ash ").name).toBe("Wren Ash");
    expect(checkName("O'Neil").problem).toBeNull();
    expect(checkName("Zoë").problem).toBeNull();
    expect(checkName("Al").problem).toBe("length");
    expect(checkName("Bob42").problem).toBe("characters");
    expect(checkName("x--y").problem).toBe("characters");
    expect(checkName("Sexy Pirate").problem).toBe("blocked");
  });

  it("every random appearance is valid and drawable", () => {
    for (let i = 0; i < 200; i++) {
      const a = randomAppearance();
      expect(appearanceFrames(a).every((f) => Number.isInteger(f) && f >= 0 && f < 54 * 12)).toBe(true);
    }
  });
});

describe("character creator endpoint", () => {
  it("saves a name and look, and the world shows them", async () => {
    const token = await newGuest();
    const look = { ...DEFAULT_APPEARANCE, body: 3, hairStyle: 4, hairColour: 2, beard: 1, hat: 5, outfit: 77 };
    const saved = await call("/profile", { name: "  Tamsin   Reed ", appearance: look }, token);
    expect(saved.status).toBe(200);
    expect(saved.body.name).toBe("Tamsin Reed");
    const me = await call("/me", undefined, token);
    expect(me.body.name).toBe("Tamsin Reed");
    expect(me.body.appearance).toEqual(look);

    const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(WORLD_ROOM, { token });
    await new Promise((r) => setTimeout(r, 150));
    const p = (room.state as { players: { get(id: string): Record<string, unknown> } }).players.get(room.sessionId);
    expect(p).toMatchObject({ name: "Tamsin Reed", body: 3, hairStyle: 4, hairColour: 2, beard: 1, hat: 5, outfit: 77 });
    await room.leave();
  });

  it("names are unique, ignoring capitals", async () => {
    const a = await newGuest();
    const b = await newGuest();
    expect((await call("/profile", { name: "Corin Vale", appearance: DEFAULT_APPEARANCE }, a)).status).toBe(200);
    const clash = await call("/profile", { name: "corin vale", appearance: DEFAULT_APPEARANCE }, b);
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe("name_taken");
    // Keeping your own name is fine.
    expect((await call("/profile", { name: "Corin Vale", appearance: { ...DEFAULT_APPEARANCE, hat: 2 } }, a)).status).toBe(200);
  });

  it("refuses bad names", async () => {
    const token = await newGuest();
    for (const [name, error] of [
      ["Al", "name_length"],
      ["Bob123", "name_characters"],
      ["call me 0800", "name_characters"],
      ["www dot com", null],
      ["F u c k", "name_blocked"],
      ["Sh!tty", "name_characters"],
    ] as const) {
      const r = await call("/profile", { name, appearance: DEFAULT_APPEARANCE }, token);
      if (error) {
        expect(r.status, name).toBe(400);
        expect(r.body.error, name).toBe(error);
      }
    }
  });

  it("refuses out-of-range, extra or wrong-typed appearance values", async () => {
    const token = await newGuest();
    for (const appearance of [
      { ...DEFAULT_APPEARANCE, outfit: 120 },
      { ...DEFAULT_APPEARANCE, body: -1 },
      { ...DEFAULT_APPEARANCE, hat: 1.5 },
      { ...DEFAULT_APPEARANCE, hairColour: "0" },
      { ...DEFAULT_APPEARANCE, glow: 1 },
      { body: 0 },
    ]) {
      const r = await call("/profile", { name: "Valid Name", appearance }, token);
      expect(r.status).toBe(400);
    }
    expect((await call("/profile", { name: "Valid Name", appearance: DEFAULT_APPEARANCE, admin: true }, token)).status).toBe(400);
  });

  it("needs a valid device token", async () => {
    expect((await call("/profile", { name: "Nobody", appearance: DEFAULT_APPEARANCE })).status).toBe(401);
    expect((await call("/profile", { name: "Nobody", appearance: DEFAULT_APPEARANCE }, "x".repeat(43))).status).toBe(401);
  });
});
