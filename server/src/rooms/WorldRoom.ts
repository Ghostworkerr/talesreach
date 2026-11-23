import { Room, ServerError, type Client } from "@colyseus/core";
import {
  MAX_MESSAGES_PER_SECOND,
  MAX_QUEUED_INPUTS,
  applyInput,
  TICK_RATE,
  DEFAULT_APPEARANCE,
  ageGroup,
  parseClientMessage,
  type ClientMessage,
  type ClientMessageType,
  type PendingInput,
} from "@talesreach/shared";
import { PlayerState, WorldState } from "./WorldState.js";
import { START_MAP, loadMap } from "../world/maps.js";
import { getAccountStore } from "../services.js";
import type { Account } from "../db/store.js";
import { storedAppearance } from "../http/accounts.js";
import { Social } from "./social.js";
import { Inn } from "./inn.js";

/** Number of placeholder colours the client knows how to draw. */
const COLOUR_COUNT = 8;

/**
 * The first region room. Clients send intentions; the server validates every
 * message against the Zod schemas in shared/ and decides the results.
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  override maxClients = 100;
  /** Built-in Colyseus guard: clients sending faster than this are disconnected. */
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;

  /**
   * Inputs waiting to be applied, per player. One is applied per tick, so
   * sending inputs faster than the tick rate can never make anyone faster;
   * the queue is capped and extras are dropped.
   */
  private readonly queues = new Map<string, PendingInput[]>();
  /** Highest input sequence number received per player (old/repeated ones are ignored). */
  private readonly lastSeq = new Map<string, number>();
  private joinCounter = 0;
  /** The map this room plays on: walls block movement; spawn points place new players. */
  readonly map = loadMap(START_MAP);
  /** Which session each account is playing in (one character per account at a time). */
  private readonly sessionsByAccount = new Map<string, string>();
  private readonly accountBySession = new Map<string, Account>();
  /** Chat, parties, block and report. */
  private readonly social = new Social({
    position: (sid) => this.state.players.get(sid),
    reject: (client, reason) => this.reject(client, reason),
  });
  /** The inn: innkeeper, room rental, beds and chests. */
  private readonly inn = new Inn({
    map: this.map,
    position: (sid) => this.state.players.get(sid),
    account: (sid) => this.accountBySession.get(sid),
    reject: (client, reason) => this.reject(client, reason),
  });

  override onCreate() {
    this.state = new WorldState();

    this.handle("ping", (client, msg) => {
      client.send("pong", { n: msg.n });
    });

    this.handle("input", (client, msg) => {
      const queue = this.queues.get(client.sessionId);
      if (!queue) return;
      if (msg.seq <= (this.lastSeq.get(client.sessionId) ?? 0)) return this.reject(client, "old input");
      this.lastSeq.set(client.sessionId, msg.seq);
      if (queue.length >= MAX_QUEUED_INPUTS) return; // too fast: dropped
      queue.push(msg);
    });

    this.handle("chat", (client, msg) => this.social.chat(client, msg));
    this.handle("block", (client, msg) => void this.social.block(client, msg));
    this.handle("unblock", (client, msg) => void this.social.unblock(client, msg));
    this.handle("report", (client, msg) => void this.social.report(client, msg));
    this.handle("partyInvite", (client, msg) => this.social.partyInvite(client, msg));
    this.handle("partyRespond", (client, msg) => this.social.partyRespond(client, msg));
    this.handle("partyLeave", (client) => this.social.partyLeave(client));
    this.handle("interact", (client, msg) => void this.inn.interact(client, msg));
    this.handle("rentRoom", (client) => void this.inn.rentRoom(client));
    this.handle("rest", (client, msg) => void this.inn.rest(client, msg));
    this.handle("chest", (client, msg) => void this.inn.chest(client, msg));

    // Any message type we don't know about is refused.
    this.onMessage("*", (client, type) => {
      this.reject(client, `unknown message type: ${String(type).slice(0, 32)}`);
    });

    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);
    // Share the server clock once a second (clients run the world clock from it).
    this.clock.setInterval(() => (this.state.serverMs = Date.now()), 1000);
  }

  /** Only players with a valid device token (from the account API) may enter. */
  override async onAuth(_client: Client, options: unknown): Promise<Account> {
    const token = (options as { token?: unknown } | null)?.token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new ServerError(401, "unknown_token");
    const account = await getAccountStore().byToken(token);
    if (!account) throw new ServerError(401, "unknown_token");
    if (ageGroup(account.dob) === "child") throw new ServerError(403, "too_young");
    return account;
  }

  override async onJoin(client: Client, _options: unknown, account: Account) {
    this.joinCounter += 1;
    // Same account joining again (another tab/device): the newer one wins.
    const previous = this.sessionsByAccount.get(account.id);
    if (previous) this.clients.find((c) => c.sessionId === previous)?.leave(4001, "signed in elsewhere");
    this.sessionsByAccount.set(account.id, client.sessionId);
    this.accountBySession.set(client.sessionId, account);
    void getAccountStore().touch(account.id);
    const player = new PlayerState();
    player.name = account.name || `Traveller ${this.joinCounter}`;
    Object.assign(player, storedAppearance(account) ?? DEFAULT_APPEARANCE);
    player.colour = (this.joinCounter - 1) % COLOUR_COUNT;
    // Wake in your rented bed, or arrive inside the Crossroads Inn at a spawn point.
    const spawns = this.map.points.filter((p) => p.type === "spawn");
    const spot = (await this.inn.wakePoint(account)) ?? spawns[(this.joinCounter - 1) % Math.max(1, spawns.length)];
    player.x = spot?.x ?? this.map.pixelWidth / 2;
    player.y = spot?.y ?? this.map.pixelHeight / 2;
    player.pid = await this.social.add(client, account, player.name);
    this.state.players.set(client.sessionId, player);
    this.queues.set(client.sessionId, []);
    this.lastSeq.set(client.sessionId, 0);
    this.state.playerCount = this.state.players.size;
    await this.inn.sendWallet(client);
  }

  override onLeave(client: Client) {
    const account = this.accountBySession.get(client.sessionId);
    this.accountBySession.delete(client.sessionId);
    if (account && this.sessionsByAccount.get(account.id) === client.sessionId) this.sessionsByAccount.delete(account.id);
    this.social.remove(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.queues.delete(client.sessionId);
    this.lastSeq.delete(client.sessionId);
    this.state.playerCount = this.state.players.size;
  }

  /** Advance the world one tick: apply at most one queued input per player. */
  tick() {
    this.state.players.forEach((player, sessionId) => {
      const input = this.queues.get(sessionId)?.shift();
      if (!input) return;
      const next = applyInput(player, input, this.map.grid);
      player.x = next.x;
      player.y = next.y;
      player.ack = input.seq;
    });
  }

  /** Register a handler that only ever sees messages that passed the shared Zod schema. */
  private handle<T extends ClientMessageType>(type: T, fn: (client: Client, msg: ClientMessage<T>) => void) {
    this.onMessage(type, (client, payload: unknown) => {
      const parsed = parseClientMessage(type, payload);
      if (!parsed.ok) return this.reject(client, parsed.reason);
      fn(client, parsed.data as ClientMessage<T>);
    });
  }

  /** Tell the client its message was refused. */
  private reject(client: Client, reason: string) {
    client.send("rejected", { reason });
  }
}
