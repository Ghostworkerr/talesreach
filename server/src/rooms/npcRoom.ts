import type { Client } from "@colyseus/core";
import { BARD_SONGS, INTERACT_RANGE, SONG_PRICE, worldTime, type ClientMessage, type GameMap } from "@talesreach/shared";
import { getAccountStore } from "../services.js";
import type { Account } from "../db/store.js";
import { NPC_DEFS, NpcBrain } from "../world/npcs.js";
import { bardDialog, innkeeperDialog, serverDialog, type Dialog, type TalkContext } from "../world/dialogue.js";
import { NpcState, type WorldState } from "./WorldState.js";

interface RoomHooks {
  map: GameMap;
  state: WorldState;
  position(sessionId: string): { x: number; y: number } | undefined;
  account(sessionId: string): Account | undefined;
  isRented(accountId: string): Promise<boolean>;
  reject(client: Client, reason: string): void;
  /** Send to everyone in the room. */
  broadcast(type: string, msg: unknown): void;
}

/** The inn staff: their routines run here; everyone sees them through the room state. */
export class Npcs {
  private readonly brains = new Map<string, NpcBrain>();
  /** How many times each account has talked to each NPC (this server session). */
  private readonly talks = new Map<string, number>();

  constructor(private readonly room: RoomHooks) {
    for (const def of NPC_DEFS) {
      const brain = new NpcBrain(def, room.map);
      this.brains.set(def.id, brain);
      const s = new NpcState();
      Object.assign(s, { name: def.name, title: def.title, frame: def.frame, x: brain.x, y: brain.y, activity: brain.activity });
      room.state.npcs.set(def.id, s);
    }
  }

  has(id: string): boolean {
    return this.brains.has(id);
  }

  position(id: string): { x: number; y: number } | undefined {
    return this.brains.get(id);
  }

  /** Advance every NPC's routine and publish positions. */
  update(dt: number, nowMs = Date.now()) {
    for (const [id, brain] of this.brains) {
      brain.update(dt, nowMs);
      const s = this.room.state.npcs.get(id);
      if (!s) continue;
      s.x = brain.x;
      s.y = brain.y;
      s.activity = brain.activity;
    }
  }

  private near(client: Client, id: string): NpcBrain | undefined {
    const npc = this.brains.get(id);
    const me = this.room.position(client.sessionId);
    if (!npc || !me) return undefined;
    return Math.hypot(npc.x - me.x, npc.y - me.y) <= INTERACT_RANGE ? npc : undefined;
  }

  async talk(client: Client, id: string) {
    const account = this.room.account(client.sessionId);
    const npc = this.near(client, id);
    if (!account) return;
    if (!npc) return this.room.reject(client, "too far");
    const key = `${account.id}:${id}`;
    const talks = this.talks.get(key) ?? 0;
    this.talks.set(key, talks + 1);
    const ctx: TalkContext = {
      playerName: account.name,
      time: worldTime(Date.now()),
      activity: npc.activity,
      talks,
      rented: id === "innkeeper" ? await this.room.isRented(account.id) : false,
    };
    const make: Record<string, (name: string, c: TalkContext) => Dialog> = { innkeeper: innkeeperDialog, server: serverDialog, bard: bardDialog };
    const dialog = make[id]?.(npc.def.name, ctx);
    if (dialog) client.send("dialog", dialog);
  }

  /** Tip the bard to play a song: costs a coin, changes the inn's music for everyone. */
  async requestSong(client: Client, msg: ClientMessage<"requestSong">) {
    const account = this.room.account(client.sessionId);
    const bard = this.near(client, "bard");
    if (!account) return;
    if (!bard) return this.room.reject(client, "too far");
    if (bard.activity !== "performing") return this.room.reject(client, "not performing");
    const paid = await getAccountStore().spend(account.id, SONG_PRICE, "bard_song");
    if (paid !== "ok") return this.room.reject(client, "not enough coins");
    this.room.state.bardSong = msg.song;
    this.room.state.bardSongSeq = (this.room.state.bardSongSeq + 1) % 65536;
    this.room.broadcast("notice", { text: `${account.name || "A traveller"} tipped ${bard.def.name} for “${BARD_SONGS[msg.song]}”.` });
    client.send("sound", { name: "coins" });
    client.send("wallet", await getAccountStore().wallet(account.id));
  }
}
