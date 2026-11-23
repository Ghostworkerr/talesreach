import { Room, type Client } from "@colyseus/core";
import {
  MAX_MESSAGES_PER_SECOND,
  TICK_RATE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  parseClientMessage,
  stepMovement,
  type ClientMessage,
  type ClientMessageType,
  type Vec2,
} from "@talesreach/shared";
import { PlayerState, WorldState } from "./WorldState.js";

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

  /** Latest walking direction per player (server memory only, never trusted as a position). */
  private readonly moveDirs = new Map<string, Vec2>();
  private joinCounter = 0;

  override onCreate() {
    this.state = new WorldState();

    this.handle("ping", (client, msg) => {
      client.send("pong", { n: msg.n });
    });

    this.handle("input", (client, msg) => {
      this.moveDirs.set(client.sessionId, { x: msg.x, y: msg.y });
    });

    // Any message type we don't know about is refused.
    this.onMessage("*", (client, type) => {
      this.reject(client, `unknown message type: ${String(type).slice(0, 32)}`);
    });

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / TICK_RATE);
  }

  override onJoin(client: Client) {
    this.joinCounter += 1;
    const player = new PlayerState();
    player.name = `Traveller ${this.joinCounter}`;
    player.colour = (this.joinCounter - 1) % COLOUR_COUNT;
    // Spawn near the middle with a small spread so players don't stack exactly.
    player.x = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 96;
    player.y = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 96;
    this.state.players.set(client.sessionId, player);
    this.moveDirs.set(client.sessionId, { x: 0, y: 0 });
    this.state.playerCount = this.state.players.size;
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.moveDirs.delete(client.sessionId);
    this.state.playerCount = this.state.players.size;
  }

  /** Advance the world by dt seconds. */
  tick(dt: number) {
    this.state.players.forEach((player, sessionId) => {
      const dir = this.moveDirs.get(sessionId);
      if (!dir || (dir.x === 0 && dir.y === 0)) return;
      const next = stepMovement(player, dir, dt);
      player.x = next.x;
      player.y = next.y;
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
