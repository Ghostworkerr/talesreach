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
  map: GameMap;
  position(sessionId: string): { x: number; y: number } | undefined;
  account(sessionId: string): Account | undefined;
  reject(client: Client, reason: string): void;
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
    if (!p || !me) return undefined;
    return Math.hypot(p.x - me.x, p.y - me.y) <= INTERACT_RANGE ? p : undefined;
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

  async interact(client: Client, msg: ClientMessage<"interact">) {
    const account = this.room.account(client.sessionId);
    if (!account) return;
    const target = this.near(client, msg.target, ["npc", "inn_room"]);
    if (!target) return this.room.reject(client, "too far");
    const w = await getAccountStore().wallet(account.id);
    const rented = w.roomUntil > Date.now();
    if (target.name === "innkeeper") {
      const greeting = account.name ? `Welcome back, ${account.name}!` : "Welcome, traveller!";
      const text = rented
        ? `${greeting} Your room's ready whenever you need it — another night is ${ROOM_PRICE} coins if you'd like to stay longer.`
        : `${greeting} A warm bed, a chest for your coins, and you'll wake here safe and sound. ${ROOM_PRICE} coins a night.`;
      const options: DialogOption[] = [
        { id: "rentRoom", label: rented ? `Stay another night (${ROOM_PRICE} coins)` : `Rent a room (${ROOM_PRICE} coins)` },
        { id: "bye", label: "Maybe later" },
      ];
      client.send("dialog", { speaker: "Innkeeper", point: "innkeeper", text, options });
    } else if (target.type === "inn_room") {
      if (!rented) {
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
    } else {
      // Other NPCs (task 1.7) answer through the NPC system.
      this.room.reject(client, "nothing to do");
    }
  }

  async rentRoom(client: Client) {
    const account = this.room.account(client.sessionId);
    if (!account) return;
    if (!this.near(client, "innkeeper", ["npc"])) return this.room.reject(client, "too far");
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
