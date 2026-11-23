import { Room, type Client } from "@colyseus/core";
import {
  MAX_MESSAGES_PER_SECOND,
  MAX_QUEUED_INPUTS,
  applyInput,
  TICK_RATE,
  parseClientMessage,
  type ClientMessage,
  type ClientMessageType,
  type PendingInput,
} from "@talesreach/shared";
import { PlayerState, WorldState } from "./WorldState.js";
import { START_MAP, loadMap } from "../world/maps.js";

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

    // Any message type we don't know about is refused.
    this.onMessage("*", (client, type) => {
      this.reject(client, `unknown message type: ${String(type).slice(0, 32)}`);
    });

    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  override onJoin(client: Client) {
    this.joinCounter += 1;
    const player = new PlayerState();
    player.name = `Traveller ${this.joinCounter}`;
    player.colour = (this.joinCounter - 1) % COLOUR_COUNT;
    // Arrive inside the Crossroads Inn, at one of the map's spawn points.
    const spawns = this.map.points.filter((p) => p.type === "spawn");
    const spot = spawns[(this.joinCounter - 1) % Math.max(1, spawns.length)];
    player.x = spot?.x ?? this.map.pixelWidth / 2;
    player.y = spot?.y ?? this.map.pixelHeight / 2;
    this.state.players.set(client.sessionId, player);
    this.queues.set(client.sessionId, []);
    this.lastSeq.set(client.sessionId, 0);
    this.state.playerCount = this.state.players.size;
  }

  override onLeave(client: Client) {
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
