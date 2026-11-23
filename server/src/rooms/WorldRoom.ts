import { Room, ServerError, type Client, type Deferred } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  INDOOR_MAPS,
  START_MAP,
  VIEW_RANGE,
  VIEW_RANGE_LEAVE,
  WORLD_MAPS,
  doorAt,
  type GameMap,
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
import { NpcState, PlayerState, WorldState } from "./WorldState.js";
import { loadMap } from "../world/maps.js";
import { WeatherSystem } from "../world/weather.js";
import { getAccountStore } from "../services.js";
import type { Account } from "../db/store.js";
import { storedAppearance } from "../http/accounts.js";
import { Social } from "./social.js";
import { Inn } from "./inn.js";
import { Npcs } from "./npcRoom.js";

/** How long a dropped player's character waits for them to reconnect. */
const RECONNECT_SECONDS = 30;

/** Number of placeholder colours the client knows how to draw. */
const COLOUR_COUNT = 8;

/** Interest management runs every this many ticks (4 times a second). */
const VIEW_EVERY_TICKS = 5;

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
  /** Every map this room serves (the region outside and interiors). Walls block movement. */
  readonly maps: Record<string, GameMap> = Object.fromEntries(WORLD_MAPS.map((name) => [name, loadMap(name)]));
  /** The inn interior: where new characters arrive, the staff work and rooms are rented. */
  readonly map = this.maps[START_MAP]!;
  private tickCount = 0;
  /** The Crossroads region's weather. */
  readonly weather = new WeatherSystem();
  /** Which session each account is playing in (one character per account at a time). */
  private readonly sessionsByAccount = new Map<string, string>();
  private readonly accountBySession = new Map<string, Account>();
  /** Dropped players waiting to reconnect (cancelled if the same account joins again). */
  private readonly waitingReconnect = new Map<string, Deferred<Client>>();
  /** Chat, parties, block and report. */
  private readonly social = new Social({
    position: (sid) => this.state.players.get(sid),
    reject: (client, reason) => this.reject(client, reason),
  });
  /** The inn: room rental, beds and chests. */
  private readonly inn = new Inn({
    map: this.map,
    mapName: START_MAP,
    position: (sid) => this.state.players.get(sid),
    account: (sid) => this.accountBySession.get(sid),
    reject: (client, reason) => this.reject(client, reason),
    npcPosition: (id) => this.npcs?.position(id),
  });
  /** Inn staff with daily routines and dialogue (created once the state exists). */
  private npcs: Npcs | null = null;

  override onCreate() {
    this.state = new WorldState();
    this.publishWeather();
    this.npcs = new Npcs({
      map: this.map,
      mapName: START_MAP,
      state: this.state,
      position: (sid) => this.state.players.get(sid),
      account: (sid) => this.accountBySession.get(sid),
      isRented: (accountId) => this.inn.isRented(accountId),
      reject: (client, reason) => this.reject(client, reason),
      broadcast: (type, msg) => this.broadcast(type, msg),
    });

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
    this.handle("interact", (client, msg) =>
      void (this.npcs?.has(msg.target) ? this.npcs.talk(client, msg.target) : this.inn.useRoom(client, msg.target)),
    );
    this.handle("requestSong", (client, msg) => void this.npcs?.requestSong(client, msg));
    this.handle("rentRoom", (client) => void this.inn.rentRoom(client));
    this.handle("rest", (client, msg) => void this.inn.rest(client, msg));
    this.handle("chest", (client, msg) => void this.inn.chest(client, msg));

    // Any message type we don't know about is refused.
    this.onMessage("*", (client, type) => {
      this.reject(client, `unknown message type: ${String(type).slice(0, 32)}`);
    });

    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);
    // Share the server clock once a second (clients run the world clock from it).
    this.clock.setInterval(() => {
      this.state.serverMs = Date.now();
      if (this.weather.update()) this.publishWeather();
    }, 1000);
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
    // Same account joining again (another tab, device, or a page reload): the newer one wins.
    const previous = this.sessionsByAccount.get(account.id);
    if (previous) {
      const waiting = this.waitingReconnect.get(previous);
      if (waiting) waiting.reject(new Error("joined again")); // its character leaves now, not in 30s
      else this.clients.find((c) => c.sessionId === previous)?.leave(4001, "signed in elsewhere");
    }
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
    player.map = START_MAP;
    player.x = spot?.x ?? this.map.pixelWidth / 2;
    player.y = spot?.y ?? this.map.pixelHeight / 2;
    player.pid = await this.social.add(client, account, player.name);
    this.state.players.set(client.sessionId, player);
    this.queues.set(client.sessionId, []);
    this.lastSeq.set(client.sessionId, 0);
    this.state.playerCount = this.state.players.size;
    this.refreshView(client, true);
    // Everyone nearby sees the newcomer at once (not at the next view update).
    for (const other of this.clients) if (other !== client) this.refreshView(other);
    await this.inn.sendWallet(client);
  }

  /** Connection dropped (phone locked, network blip): keep the character for a while so the player can reconnect. */
  override onDrop(client: Client) {
    this.queues.set(client.sessionId, []); // stand still while away
    const waiting = this.allowReconnection(client, RECONNECT_SECONDS);
    this.waitingReconnect.set(client.sessionId, waiting);
    waiting.then(
      () => this.waitingReconnect.delete(client.sessionId),
      () => this.waitingReconnect.delete(client.sessionId),
    );
  }

  /** Back after a drop: same character, same place. Re-attach chat/party and resend private info. */
  override async onReconnect(client: Client) {
    this.social.rebind(client);
    this.refreshView(client, true);
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

  /** Advance the world one tick: apply at most one queued input per player; NPCs go about their day. */
  tick() {
    this.npcs?.update(1 / TICK_RATE);
    this.state.players.forEach((player, sessionId) => {
      const input = this.queues.get(sessionId)?.shift();
      if (!input) return;
      const map = this.maps[player.map] ?? this.map;
      const next = applyInput(player, input, map.grid);
      player.x = next.x;
      player.y = next.y;
      player.ack = input.seq;
      // Stepped into a doorway: the server moves you to the other map (the client never picks).
      const door = doorAt(map, player.x, player.y);
      if (door) this.travel(sessionId, player, door.to, door.spot);
    });
    this.tickCount += 1;
    if (this.tickCount % VIEW_EVERY_TICKS === 0) for (const client of this.clients) this.refreshView(client);
  }

  /** Copy the weather into the shared state (everyone sees the same sky). */
  publishWeather() {
    this.state.weather = this.weather.kind;
    this.state.weatherPrev = this.weather.previous;
    this.state.weatherSince = this.weather.since;
  }

  /** Move a player to an arrival point on another map (through a door). */
  private travel(sessionId: string, player: PlayerState, mapName: string, spotName: string) {
    const target = this.maps[mapName];
    const spot = target?.points.find((p) => p.name === spotName);
    if (!target || !spot) return; // a broken door goes nowhere
    player.map = mapName;
    player.x = spot.x;
    player.y = spot.y;
    this.queues.set(sessionId, []); // inputs typed on the old map are dropped
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) {
      client.send("travel", { map: mapName, x: spot.x, y: spot.y, ack: player.ack });
      client.send("sound", { name: "doorOpen" });
      // Same view object: the people left behind are removed from this client (a new view wouldn't).
      this.refreshView(client);
    }
  }

  /**
   * Interest management: this client sees itself, plus players and NPCs on the
   * same map within view range (they stay until a bit further, so nothing flickers).
   */
  private refreshView(client: Client, fresh = false) {
    const me = this.state.players.get(client.sessionId);
    if (!me) return;
    if (fresh || !client.view) client.view = new StateView();
    const view = client.view;
    // Fog and storms shorten sight outdoors: you really can't see (or be seen) as far.
    const sight = INDOOR_MAPS.includes(me.map) ? 1 : this.weather.effects.sight;
    const sees = (o: { x: number; y: number; map: string }) => {
      if (o.map !== me.map) return false;
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      return view.has(o as never) ? d <= VIEW_RANGE_LEAVE * sight : d <= VIEW_RANGE * sight;
    };
    const apply = (o: PlayerState | NpcState, visible: boolean) => {
      if (visible && !view.has(o)) view.add(o);
      else if (!visible && view.has(o)) view.remove(o);
    };
    this.state.players.forEach((p) => apply(p, p === me || sees(p)));
    this.state.npcs.forEach((n) => apply(n, sees(n)));
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
