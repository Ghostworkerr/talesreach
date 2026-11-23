import type { Client } from "@colyseus/core";
import { INTERACT_RANGE, ROOM_PRICE, type ClientMessage, type GameMap, type MapPoint, type Wallet } from "@talesreach/shared";
import { getAccountStore } from "../services.js";
import type { Account } from "../db/store.js";

/** What a dialog option does when chosen (the client sends the matching message). */
export interface DialogOption {
  id: string;
  label: string;
}

interface RoomHooks {
  /** The inn's own map (an interior) and its name. */
  map: GameMap;
  mapName: string;
  position(sessionId: string): { x: number; y: number; map: string } | undefined;
  account(sessionId: string): Account | undefined;
  reject(client: Client, reason: string): void;
  /** Where an NPC is right now (NPCs walk around). */
  npcPosition(id: string): { x: number; y: number } | undefined;
}

/**
 * The Crossroads Inn: talk to the innkeeper, rent a room for a world day,
 * rest in your bed (you wake there), and keep coins in your room's chest.
 * Every coin change goes through the store's transactions and economy log.
 */
export class Inn {
  constructor(private readonly room: RoomHooks) {}

  /** A point you can use, if it exists and you're close enough. */
  private near(client: Client, name: string, types: string[]): MapPoint | undefined {
    const p = this.room.map.points.find((pt) => pt.name === name && types.includes(pt.type));
    const me = this.room.position(client.sessionId);
    if (!p || !me || me.map !== this.room.mapName) return undefined;
    return Math.hypot(p.x - me.x, p.y - me.y) <= INTERACT_RANGE ? p : undefined;
  }

  /** Close enough to talk to the innkeeper, wherever she is right now. */
  private nearInnkeeper(client: Client): boolean {
    const keeper = this.room.npcPosition("innkeeper");
    const me = this.room.position(client.sessionId);
    return !!keeper && !!me && me.map === this.room.mapName && Math.hypot(keeper.x - me.x, keeper.y - me.y) <= INTERACT_RANGE;
  }

  async isRented(accountId: string): Promise<boolean> {
    return (await getAccountStore().wallet(accountId)).roomUntil > Date.now();
  }

  async sendWallet(client: Client): Promise<Wallet | undefined> {
    const account = this.room.account(client.sessionId);
    if (!account) return undefined;
    const wallet = await getAccountStore().wallet(account.id);
    client.send("wallet", wallet);
    return wallet;
  }

  /** Where this player should wake up: their bed, while their room is rented. */
  async wakePoint(account: Account): Promise<MapPoint | undefined> {
    const w = await getAccountStore().wallet(account.id);
    if (!w.restPoint || w.roomUntil <= Date.now()) return undefined;
    return this.room.map.points.find((p) => p.name === w.restPoint && p.type === "inn_room");
  }

  /** Using an inn room (bed + chest). Talking to people goes through the NPC system. */
  async useRoom(client: Client, pointName: string) {
    const account = this.room.account(client.sessionId);
    if (!account) return;
    const target = this.near(client, pointName, ["inn_room"]);
    if (!target) return this.room.reject(client, "too far");
    const w = await getAccountStore().wallet(account.id);
    if (w.roomUntil <= Date.now()) {
      client.send("dialog", {
        speaker: "Inn room",
        point: target.name,
        text: "A cosy room with a soft bed and a sturdy chest. Rent a room from the innkeeper to use it.",
        options: [{ id: "bye", label: "OK" }],
      });
      return;
    }
    client.send("dialog", {
      speaker: "Your room",
      point: target.name,
      text: `Your bed and chest. You have ${w.coins} coins on you and ${w.chest} in the chest.`,
      options: [
        { id: `rest:${target.name}`, label: w.restPoint === target.name ? "Rest (this is your bed)" : "Rest here — wake up here" },
        { id: "chest", label: "Open the chest" },
        { id: "bye", label: "Leave" },
      ],
    });
  }

  async rentRoom(client: Client) {
    const account = this.room.account(client.sessionId);
    if (!account) return;
    if (!this.nearInnkeeper(client)) return this.room.reject(client, "too far");
    const result = await getAccountStore().rentRoom(account.id, ROOM_PRICE, Date.now());
    if (result !== "ok") return this.room.reject(client, "not enough coins");
    client.send("notice", { text: `You rented a room for ${ROOM_PRICE} coins. Rest in your bed to wake up there.` });
    client.send("sound", { name: "coins" });
    await this.sendWallet(client);
  }

  async rest(client: Client, msg: ClientMessage<"rest">) {
    const account = this.room.account(client.sessionId);
    if (!account) return;
    const bed = this.near(client, msg.point, ["inn_room"]);
    if (!bed) return this.room.reject(client, "too far");
    const w = await getAccountStore().wallet(account.id);
    if (w.roomUntil <= Date.now()) return this.room.reject(client, "no room");
    await getAccountStore().setRestPoint(account.id, bed.name);
    client.send("notice", { text: "You'll wake up here while your room is rented. Sleep well!" });
    await this.sendWallet(client);
  }

  async chest(client: Client, msg: ClientMessage<"chest">) {
    const account = this.room.account(client.sessionId);
    if (!account) return;
    const roomPoint = this.room.map.points.find((p) => p.type === "inn_room" && this.near(client, p.name, ["inn_room"]));
    if (!roomPoint) return this.room.reject(client, "too far");
    const w = await getAccountStore().wallet(account.id);
    if (w.roomUntil <= Date.now()) return this.room.reject(client, "no room");
    const result = await getAccountStore().moveChestCoins(account.id, msg.amount);
    if (result === "poor") return this.room.reject(client, "not enough coins");
    if (result === "empty") return this.room.reject(client, "not enough in the chest");
    client.send("sound", { name: "coins2" });
    await this.sendWallet(client);
  }
}
