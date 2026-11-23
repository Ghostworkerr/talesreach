import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import { DEFAULT_APPEARANCE, MOVE_STEP_SECONDS, WORLD_ROOM, maskProfanity, stripContactInfo, stripLinks } from "@talesreach/shared";
import { createGameServer } from "../server/src/app.js";
import { openStore } from "../server/src/db/store.js";

const PORT = 2596;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "test-admin-password-0123456789";
let server: Server;

beforeAll(async () => {
  process.env.ADMIN_TOKEN = ADMIN;
  const { store } = await openStore("");
  server = createGameServer({ store, rateLimits: { general: 10_000, login: 10_000 } });
  await server.listen(PORT, "127.0.0.1");
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
  delete process.env.ADMIN_TOKEN;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nameCounter = 0;
const NAMES = ["Alda", "Brin", "Cael", "Dora", "Eamon", "Fiora", "Gale", "Hesta", "Ivar", "Jessa", "Korin", "Lys", "Mabel", "Nolan", "Olwen", "Pip", "Quinn", "Rhea", "Sten", "Tova", "Uma", "Vick", "Wilda", "Xan", "Yorick", "Zeph"];

interface Player {
  room: Room;
  token: string;
  pid: string;
  name: string;
  inbox: { type: string; msg: Record<string, unknown> }[];
}

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { token: string };
}

/** A new player with a name, joined to the world and recording every message it receives. */
async function player(dob = "1990-01-01", tokenOverride?: string): Promise<Player> {
  const name = `${NAMES[nameCounter % NAMES.length]} ${String.fromCharCode(65 + Math.floor(nameCounter / NAMES.length))}`.trim();
  nameCounter++;
  let token = tokenOverride;
  if (!token) {
    token = (await post("/guest", { dob })).token;
    await post("/profile", { name: name.replace(/ ([A-Z])$/, " $1a"), appearance: DEFAULT_APPEARANCE }, token);
  }
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate(WORLD_ROOM, { token });
  const inbox: Player["inbox"] = [];
  for (const type of ["chat", "rejected", "blocked", "unblocked", "reported", "partyInvite", "party", "notice"]) {
    room.onMessage(type, (msg: Record<string, unknown>) => inbox.push({ type, msg }));
  }
  room.onMessage("pong", () => undefined);
  await wait(150);
  const me = (room.state as { players: { get(id: string): { pid: string; name: string } } }).players.get(room.sessionId);
  return { room, token, pid: me.pid, name: me.name, inbox };
}
const chats = (p: Player) => p.inbox.filter((m) => m.type === "chat").map((m) => m.msg.text as string);
const rejections = (p: Player) => p.inbox.filter((m) => m.type === "rejected").map((m) => m.msg.reason as string);
const leaveAll = async (...ps: Player[]) => Promise.all(ps.map((p) => p.room.leave().catch(() => undefined)));

async function walk(p: Player, dir: { x: number; y: number }, steps: number) {
  const ack = (p.room.state as { players: { get(id: string): { ack: number } } }).players.get(p.room.sessionId).ack;
  for (let i = 1; i <= steps; i++) {
    p.room.send("input", { seq: ack + i, ...dir });
    await wait(MOVE_STEP_SECONDS * 1000);
  }
  await wait(200);
}

describe("chat filters (unit)", () => {
  it("masks profanity and removes links for everyone", () => {
    expect(maskProfanity("what the fuck")).toBe("what the ****");
    expect(stripLinks("visit www.freegold.com now")).toBe("visit [link removed] now");
    expect(stripLinks("mail kid@example.com")).toBe("mail [removed]");
    expect(stripLinks("I have 12 coins")).toBe("I have 12 coins");
  });

  it("removes phone numbers, emails and social handles for minors", () => {
    expect(stripContactInfo("call me 0803 123 4567")).toBe("call me [removed]");
    expect(stripContactInfo("my snap is coolkid99 add me")).not.toContain("coolkid99");
    expect(stripContactInfo("follow @coolkid")).not.toContain("coolkid");
    expect(stripContactInfo("the year 1066 was wild")).toBe("the year 1066 was wild");
  });
});

describe("local chat", () => {
  it("reaches nearby players (including you), not players far away", async () => {
    const a = await player();
    const b = await player();
    const far = await player();
    await walk(far, { x: 1, y: 1 }, 70); // to the hall's far south-east corner, out of earshot
    a.room.send("chat", { channel: "local", text: "Hello, inn!" });
    await wait(300);
    expect(chats(a)).toContain("Hello, inn!");
    expect(chats(b)).toContain("Hello, inn!");
    expect(chats(far)).not.toContain("Hello, inn!");
    await leaveAll(a, b, far);
  });

  it("masks swearing and links; minors never see or send contact details", async () => {
    const adult = await player("1990-01-01");
    const adult2 = await player("1985-06-06");
    const minor = await player("2011-01-01");
    adult.room.send("chat", { channel: "local", text: "what the fuck, see www.gold.com or call 0803 123 4567" });
    await wait(300);
    expect(chats(adult2).at(-1)).toBe("what the ****, see [link removed] or call 0803 123 4567");
    expect(chats(minor).at(-1)).toBe("what the ****, see [link removed] or call [removed]");
    minor.room.send("chat", { channel: "local", text: "add me on snap coolkid99" });
    await wait(300);
    expect(chats(adult2).at(-1)).not.toContain("coolkid99");
    await leaveAll(adult, adult2, minor);
  });

  it("stops spam and floods", async () => {
    const a = await player();
    for (let i = 0; i < 3; i++) a.room.send("chat", { channel: "local", text: "BUY GOLD" });
    await wait(300);
    expect(rejections(a)).toContain("no spamming");
    for (let i = 0; i < 8; i++) a.room.send("chat", { channel: "local", text: `line ${i}` });
    await wait(300);
    expect(rejections(a)).toContain("slow down");
    await leaveAll(a);
  });

  it("refuses bad chat messages", async () => {
    const a = await player();
    for (const bad of [
      { channel: "local", text: "x".repeat(201) },
      { channel: "local", text: "" },
      { channel: "shout", text: "hi" },
      { channel: "local", text: "hi", as: "admin" },
      { text: "hi" },
    ]) {
      a.room.send("chat", bad);
    }
    a.room.send("chat", { channel: "local", text: "   ​\u0007  " });
    await wait(300);
    expect(rejections(a).filter((r) => r === "invalid payload").length).toBe(5);
    expect(rejections(a)).toContain("empty message");
    expect(chats(a)).toEqual([]);
    await leaveAll(a);
  });
});

describe("block and report", () => {
  it("blocking hides chat both ways and is remembered after re-joining", async () => {
    const a = await player();
    const b = await player();
    a.room.send("block", { pid: b.pid });
    await wait(200);
    expect(a.inbox.some((m) => m.type === "blocked")).toBe(true);
    b.room.send("chat", { channel: "local", text: "can you hear me" });
    a.room.send("chat", { channel: "local", text: "silence" });
    await wait(300);
    expect(chats(a)).not.toContain("can you hear me");
    expect(chats(b)).not.toContain("silence");
    // Re-join as A: still blocked.
    await a.room.leave();
    const a2 = await player(undefined, a.token);
    b.room.send("chat", { channel: "local", text: "hello again" });
    await wait(300);
    expect(chats(a2)).not.toContain("hello again");
    // Unblock restores chat.
    a2.room.send("unblock", { pid: b.pid });
    await wait(200);
    b.room.send("chat", { channel: "local", text: "friends now?" });
    await wait(300);
    expect(chats(a2)).toContain("friends now?");
    await leaveAll(a2, b);
  });

  it("reports go to the admin queue with server-captured evidence", async () => {
    const a = await player();
    const rude = await player();
    rude.room.send("chat", { channel: "local", text: "you are terrible at this" });
    await wait(300);
    a.room.send("report", { pid: rude.pid, reason: "bullying", note: "keeps insulting me" });
    a.room.send("report", { pid: a.pid, reason: "other" }); // yourself: refused
    await wait(300);
    expect(a.inbox.some((m) => m.type === "reported")).toBe(true);
    expect(rejections(a)).toContain("can't report yourself");

    expect((await fetch(`${BASE}/api/admin/reports`)).status).toBe(401);
    expect((await fetch(`${BASE}/api/admin/reports`, { headers: { Authorization: "Bearer wrong-password-0123456789" } })).status).toBe(401);
    const list = (await (await fetch(`${BASE}/api/admin/reports`, { headers: { Authorization: `Bearer ${ADMIN}` } })).json()) as {
      reports: { id: number; reportedName: string; reason: string; note: string; evidence: { who: string; lines: { text: string }[] }[] }[];
    };
    const r = list.reports.find((x) => x.reportedName === rude.name);
    expect(r?.reason).toBe("bullying");
    expect(r?.note).toBe("keeps insulting me");
    expect(r?.evidence.find((e) => e.who === "reported")?.lines.map((l) => l.text)).toContain("you are terrible at this");
    const done = await fetch(`${BASE}/api/admin/reports/${r!.id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(done.status).toBe(200);
    expect((await fetch(`${BASE}/admin`)).status).toBe(200);
    await leaveAll(a, rude);
  });

  it("refuses bad block/report messages and limits report spam", async () => {
    const a = await player();
    const b = await player();
    a.room.send("block", { pid: "not-a-pid" });
    a.room.send("block", { pid: "aaaaaaaaaaaa" });
    a.room.send("report", { pid: b.pid, reason: "made-up" });
    a.room.send("report", { pid: b.pid, reason: "other", note: "x".repeat(301) });
    for (let i = 0; i < 7; i++) a.room.send("report", { pid: b.pid, reason: "other" });
    await wait(400);
    const r = rejections(a);
    expect(r.filter((x) => x === "invalid payload").length).toBe(3);
    expect(r).toContain("player not found");
    expect(r).toContain("too many reports");
    await leaveAll(a, b);
  });
});

describe("parties", () => {
  it("invite, accept, party-only chat, leave", async () => {
    const host = await player();
    const friend = await player();
    const stranger = await player();
    host.room.send("chat", { channel: "party", text: "anyone?" });
    await wait(200);
    expect(rejections(host)).toContain("not in a party");

    host.room.send("partyInvite", { pid: friend.pid });
    await wait(200);
    expect(friend.inbox.some((m) => m.type === "partyInvite" && m.msg.pid === host.pid)).toBe(true);
    friend.room.send("partyRespond", { accept: true });
    await wait(200);
    const party = host.inbox.filter((m) => m.type === "party").at(-1)?.msg.members as { pid: string }[];
    expect(party.map((m) => m.pid).sort()).toEqual([host.pid, friend.pid].sort());

    host.room.send("chat", { channel: "party", text: "secret plan" });
    await wait(300);
    expect(chats(friend)).toContain("secret plan");
    expect(chats(stranger)).not.toContain("secret plan");

    friend.room.send("partyLeave", {});
    await wait(200);
    expect((host.inbox.filter((m) => m.type === "party").at(-1)?.msg.members as unknown[]).length).toBe(0);
    await leaveAll(host, friend, stranger);
  });

  it("parties hold at most 5, and you can't answer an invite you never got", async () => {
    const host = await player();
    const others = await Promise.all([1, 2, 3, 4, 5].map(() => player()));
    for (const o of others.slice(0, 4)) {
      host.room.send("partyInvite", { pid: o.pid });
      await wait(100);
      o.room.send("partyRespond", { accept: true });
      await wait(150);
    }
    host.room.send("partyInvite", { pid: others[4]!.pid });
    await wait(200);
    expect(rejections(host)).toContain("party is full");
    others[4]!.room.send("partyRespond", { accept: true });
    await wait(200);
    expect(rejections(others[4]!)).toContain("no invite");
    await leaveAll(host, ...others);
  });
});
