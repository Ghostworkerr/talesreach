import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { DateOfBirth, SaveCode, WORLD_ROOM, ageGroup, ageOn } from "@talesreach/shared";
import { createGameServer } from "../server/src/app.js";
import { openStore } from "../server/src/db/store.js";

const PORT = 2598;
const BASE = `http://127.0.0.1:${PORT}`;
let server: Server;

beforeAll(async () => {
  const { store } = await openStore(""); // in-memory Postgres; default (real) rate limits
  server = createGameServer({ store });
  await server.listen(PORT, "127.0.0.1");
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

interface Reply {
  token: string;
  code: string;
  error: string;
  account: { ageGroup: string };
}
/** Read a JSON reply from the account API. */
const reply = async (res: Response | Promise<Response>) => (await (await res).json()) as Reply;

/** A date of birth for someone exactly `years` old today, minus `days`. */
function dobForAge(years: number, days = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

describe("age rules", () => {
  it("computes ages around birthdays", () => {
    const now = new Date(Date.UTC(2026, 10, 23));
    expect(ageOn("2013-11-23", now)).toBe(13);
    expect(ageOn("2013-11-24", now)).toBe(12);
    expect(ageGroup("2013-11-24", now)).toBe("child");
    expect(ageGroup("2013-11-23", now)).toBe("minor");
    expect(ageGroup("2008-11-23", now)).toBe("adult");
    expect(ageGroup("2008-11-24", now)).toBe("minor");
  });

  it("only accepts real past dates", () => {
    for (const bad of ["2010-02-30", "2010-13-01", "1850-01-01", "3000-01-01", "yesterday", "2010-1-1", ""]) {
      expect(DateOfBirth.safeParse(bad).success).toBe(false);
    }
    expect(DateOfBirth.safeParse("2000-02-29").success).toBe(true);
  });

  it("save codes accept dashes and lowercase, refuse look-alike letters", () => {
    expect(SaveCode.parse("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(SaveCode.safeParse("ABCD-EFGH-IJKL").success).toBe(false); // I and L are never used
    expect(SaveCode.safeParse("ABCD").success).toBe(false);
  });
});

describe("guest sign-up", () => {
  it("adults and teens get an account; teens are marked as minors", async () => {
    const adult = await reply(post("/guest", { dob: dobForAge(25) }));
    expect(adult.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(adult.account.ageGroup).toBe("adult");
    const teen = await reply(post("/guest", { dob: dobForAge(15) }));
    expect(teen.account.ageGroup).toBe("minor");
  });

  it("under-13s are refused (one day short of 13 too)", async () => {
    for (const dob of [dobForAge(9), dobForAge(13, -1)]) {
      const res = await post("/guest", { dob });
      expect(res.status).toBe(403);
      expect((await reply(res)).error).toBe("too_young");
    }
  });

  it("refuses bad, extra, oversized and non-JSON bodies", async () => {
    for (const body of [{ dob: "2010-02-30" }, { dob: dobForAge(20), admin: true }, {}, "not json", { dob: "x".repeat(5000) }]) {
      const res = await post("/guest", body);
      expect([400, 413]).toContain(res.status);
    }
  });
});

describe("joining the world needs a valid account", () => {
  it("no token, a forged token or a junk token are all refused", async () => {
    for (const options of [{}, { token: "A".repeat(43) }, { token: "<script>" }, { token: 42 }]) {
      await expect(new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(WORLD_ROOM, options)).rejects.toThrow();
    }
  });

  it("a real token joins; the same account joining again replaces the first session", async () => {
    const { token } = await reply(post("/guest", { dob: dobForAge(30) }));
    const first = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(WORLD_ROOM, { token });
    const kicked = new Promise<number>((resolve) => first.onLeave((code) => resolve(code)));
    const second = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(WORLD_ROOM, { token });
    expect(await kicked).toBe(4001);
    await second.leave();
  });
});

describe("save codes", () => {
  it("make a code, log in on another device with it, old codes stop working", async () => {
    const { token } = await reply(post("/guest", { dob: dobForAge(22) }));
    expect((await post("/save-code", {})).status).toBe(401); // needs the device token
    const { code } = await reply(post("/save-code", {}, token));
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const login = await reply(post("/login", { code: code.toLowerCase() }));
    expect(login.token).toBeTruthy();
    expect(login.token).not.toBe(token);
    const me = await reply(fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${login.token}` } }));
    expect(me.account.ageGroup).toBe("adult");

    const { code: newer } = await reply(post("/save-code", {}, token));
    expect(newer).not.toBe(code);
    expect((await post("/login", { code })).status).toBe(401);
  });

  it("a token in the URL is never accepted", async () => {
    const { token } = await reply(post("/guest", { dob: dobForAge(22) }));
    expect((await fetch(`${BASE}/api/me?token=${token}`)).status).toBe(401);
  });

  it("guessing save codes is rate-limited", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post("/login", { code: "AAAA-BBBB-CCCC" })).status);
    expect(statuses).toContain(429);
  });
});
