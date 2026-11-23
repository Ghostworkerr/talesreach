import type { Client } from "@colyseus/core";
import {
  LOCAL_CHAT_RANGE,
  PARTY_MAX,
  RateLimiter,
  ageGroup,
  maskProfanity,
  stripContactInfo,
  stripLinks,
  tidyChat,
  type ClientMessage,
} from "@talesreach/shared";
import { getAccountStore } from "../services.js";
import { publicId, type Account } from "../db/store.js";

/** Server-only facts about a player for chat and safety. Never sent to other players. */
interface SocialPlayer {
  client: Client;
  account: Account;
  pid: string;
  name: string;
  minor: boolean;
  /** Accounts hidden from this player (blocked by them or blocking them). */
  hidden: Set<string>;
  /** Recent chat lines, kept briefly as evidence for reports. */
  recent: { at: string; channel: string; text: string }[];
  chatLimiter: RateLimiter;
  reportLimiter: RateLimiter;
  inviteLimiter: RateLimiter;
  lastText: string;
  repeats: number;
}

const RECENT_LINES = 12;
const INVITE_TTL_MS = 60_000;

interface RoomHooks {
  position(sessionId: string): { x: number; y: number } | undefined;
  reject(client: Client, reason: string): void;
}

/** Local + party chat, mute/block/report and parties for one room. */
export class Social {
  private readonly players = new Map<string, SocialPlayer>();
  private readonly sessionByPid = new Map<string, string>();
  private readonly partyOf = new Map<string, number>();
  private readonly parties = new Map<number, Set<string>>();
  private readonly invites = new Map<string, { from: string; expires: number }>();
  private nextParty = 1;

  constructor(private readonly room: RoomHooks) {}

  async add(client: Client, account: Account, name: string): Promise<string> {
    const pid = publicId(account.id);
    this.players.set(client.sessionId, {
      client,
      account,
      pid,
      name,
      minor: ageGroup(account.dob) !== "adult",
      hidden: await getAccountStore().blockedEitherWay(account.id),
      recent: [],
      chatLimiter: new RateLimiter(1, 4), // about one line a second, short bursts allowed
      reportLimiter: new RateLimiter(5 / 600, 5), // 5 reports per 10 minutes
      inviteLimiter: new RateLimiter(6 / 60, 6),
      lastText: "",
      repeats: 0,
    });
    this.sessionByPid.set(pid, client.sessionId);
    return pid;
  }

  /** A player reconnected (new connection object, same session): send to the new one. */
  rebind(client: Client) {
    const p = this.players.get(client.sessionId);
    if (p) p.client = client;
  }

  remove(sessionId: string) {
    const p = this.players.get(sessionId);
    if (!p) return;
    this.leaveParty(sessionId);
    this.invites.delete(sessionId);
    this.players.delete(sessionId);
    if (this.sessionByPid.get(p.pid) === sessionId) this.sessionByPid.delete(p.pid);
  }

  // ---------------------------------------------------------------- chat
  chat(client: Client, msg: ClientMessage<"chat">) {
    const me = this.players.get(client.sessionId);
    if (!me) return;
    let text = tidyChat(msg.text);
    if (!text) return this.room.reject(client, "empty message");
    if (!me.chatLimiter.allow()) return this.room.reject(client, "slow down");
    if (text.toLowerCase() === me.lastText) {
      if (++me.repeats >= 2) return this.room.reject(client, "no spamming");
    } else {
      me.lastText = text.toLowerCase();
      me.repeats = 0;
    }
    // Everyone: no swearing, no links. Minors' messages: no contact details either.
    text = stripLinks(maskProfanity(text));
    if (me.minor) text = stripContactInfo(text);
    me.recent.push({ at: new Date().toISOString(), channel: msg.channel, text: msg.text.slice(0, 200) });
    if (me.recent.length > RECENT_LINES) me.recent.shift();

    const recipients = msg.channel === "party" ? this.partyMembers(client.sessionId) : this.nearby(client.sessionId);
    if (msg.channel === "party" && recipients.length <= 1) return this.room.reject(client, "not in a party");
    for (const sid of recipients) {
      const r = this.players.get(sid);
      if (!r || this.hiddenBetween(me, r)) continue;
      // Anything shown to a minor has contact details removed too.
      const shown = r.minor ? stripContactInfo(text) : text;
      r.client.send("chat", { pid: me.pid, name: me.name, channel: msg.channel, text: shown });
    }
  }

  private nearby(sessionId: string): string[] {
    const here = this.room.position(sessionId);
    if (!here) return [];
    const out: string[] = [];
    for (const sid of this.players.keys()) {
      const there = this.room.position(sid);
      if (there && Math.hypot(there.x - here.x, there.y - here.y) <= LOCAL_CHAT_RANGE) out.push(sid);
    }
    return out;
  }

  private hiddenBetween(a: SocialPlayer, b: SocialPlayer): boolean {
    return a !== b && (a.hidden.has(b.account.id) || b.hidden.has(a.account.id));
  }

  // ---------------------------------------------------------------- block / report
  async block(client: Client, msg: ClientMessage<"block">) {
    const me = this.players.get(client.sessionId);
    const them = this.byPid(msg.pid);
    if (!me || !them) return this.room.reject(client, "player not found");
    if (them === me) return this.room.reject(client, "can't block yourself");
    await getAccountStore().block(me.account.id, them.account.id);
    me.hidden.add(them.account.id);
    them.hidden.add(me.account.id);
    // Blocking also ends any shared party and pending invites between you.
    if (this.partyOf.get(client.sessionId) !== undefined && this.partyOf.get(client.sessionId) === this.partyOf.get(them.client.sessionId)) {
      this.leaveParty(client.sessionId);
    }
    if (this.invites.get(client.sessionId)?.from === them.client.sessionId) this.invites.delete(client.sessionId);
    if (this.invites.get(them.client.sessionId)?.from === client.sessionId) this.invites.delete(them.client.sessionId);
    client.send("blocked", { pid: them.pid });
  }

  async unblock(client: Client, msg: ClientMessage<"unblock">) {
    const me = this.players.get(client.sessionId);
    const them = this.byPid(msg.pid);
    if (!me || !them) return this.room.reject(client, "player not found");
    await getAccountStore().unblock(me.account.id, them.account.id);
    me.hidden = await getAccountStore().blockedEitherWay(me.account.id);
    them.hidden = await getAccountStore().blockedEitherWay(them.account.id);
    client.send("unblocked", { pid: them.pid });
  }

  async report(client: Client, msg: ClientMessage<"report">) {
    const me = this.players.get(client.sessionId);
    const them = this.byPid(msg.pid);
    if (!me || !them) return this.room.reject(client, "player not found");
    if (them === me) return this.room.reject(client, "can't report yourself");
    if (!me.reportLimiter.allow()) return this.room.reject(client, "too many reports");
    await getAccountStore().addReport({
      reporterId: me.account.id,
      reportedId: them.account.id,
      reportedName: them.name,
      reason: msg.reason,
      note: tidyChat(msg.note ?? "").slice(0, 300),
      // Evidence captured by the server, not typed by the reporter.
      evidence: [
        { who: "reported", lines: them.recent },
        { who: "reporter", lines: me.recent.slice(-5) },
      ],
    });
    client.send("reported", { pid: them.pid });
  }

  // ---------------------------------------------------------------- parties
  partyInvite(client: Client, msg: ClientMessage<"partyInvite">) {
    const me = this.players.get(client.sessionId);
    const them = this.byPid(msg.pid);
    if (!me || !them) return this.room.reject(client, "player not found");
    if (them === me) return this.room.reject(client, "can't invite yourself");
    if (this.hiddenBetween(me, them)) return this.room.reject(client, "player not found");
    if (!me.inviteLimiter.allow()) return this.room.reject(client, "slow down");
    const myParty = this.partyOf.get(client.sessionId);
    if (myParty !== undefined && myParty === this.partyOf.get(them.client.sessionId)) return this.room.reject(client, "already in your party");
    if (myParty !== undefined && (this.parties.get(myParty)?.size ?? 0) >= PARTY_MAX) return this.room.reject(client, "party is full");
    this.invites.set(them.client.sessionId, { from: client.sessionId, expires: Date.now() + INVITE_TTL_MS });
    them.client.send("partyInvite", { pid: me.pid, name: me.name });
    client.send("notice", { text: `Invited ${them.name} to your party.` });
  }

  partyRespond(client: Client, msg: ClientMessage<"partyRespond">) {
    const invite = this.invites.get(client.sessionId);
    this.invites.delete(client.sessionId);
    const me = this.players.get(client.sessionId);
    const host = invite && this.players.get(invite.from);
    if (!me || !invite || !host || invite.expires < Date.now()) return this.room.reject(client, "no invite");
    if (!msg.accept) {
      host.client.send("notice", { text: `${me.name} declined your invite.` });
      return;
    }
    let partyId = this.partyOf.get(invite.from);
    if (partyId === undefined) {
      partyId = this.nextParty++;
      this.parties.set(partyId, new Set([invite.from]));
      this.partyOf.set(invite.from, partyId);
    }
    const party = this.parties.get(partyId)!;
    if (party.size >= PARTY_MAX) return this.room.reject(client, "party is full");
    this.leaveParty(client.sessionId);
    party.add(client.sessionId);
    this.partyOf.set(client.sessionId, partyId);
    this.sendParty(partyId);
  }

  partyLeave(client: Client) {
    if (this.partyOf.get(client.sessionId) === undefined) return this.room.reject(client, "not in a party");
    this.leaveParty(client.sessionId);
  }

  private leaveParty(sessionId: string) {
    const partyId = this.partyOf.get(sessionId);
    if (partyId === undefined) return;
    this.partyOf.delete(sessionId);
    const party = this.parties.get(partyId);
    party?.delete(sessionId);
    this.players.get(sessionId)?.client.send("party", { members: [] });
    if (!party || party.size <= 1) {
      // A party of one isn't a party.
      for (const sid of party ?? []) {
        this.partyOf.delete(sid);
        this.players.get(sid)?.client.send("party", { members: [] });
      }
      this.parties.delete(partyId);
    } else this.sendParty(partyId);
  }

  private partyMembers(sessionId: string): string[] {
    const partyId = this.partyOf.get(sessionId);
    return partyId === undefined ? [] : [...(this.parties.get(partyId) ?? [])];
  }

  private sendParty(partyId: number) {
    const party = this.parties.get(partyId);
    if (!party) return;
    const members = [...party].map((sid) => this.players.get(sid)).filter(Boolean).map((p) => ({ pid: p!.pid, name: p!.name }));
    for (const sid of party) this.players.get(sid)?.client.send("party", { members });
  }

  private byPid(pid: string): SocialPlayer | undefined {
    const sid = this.sessionByPid.get(pid);
    return sid ? this.players.get(sid) : undefined;
  }
}
