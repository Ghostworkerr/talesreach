import { Room, type Client } from "@colyseus/core";
import { MAX_MESSAGES_PER_SECOND, parseClientMessage } from "@talesreach/shared";
import { WorldState } from "./WorldState.js";

/**
 * The first region room. Clients send intentions; the server validates every
 * message against the Zod schemas in shared/ and decides the results.
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  override maxClients = 100;
  /** Built-in Colyseus guard: clients sending faster than this are disconnected. */
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;

  override onCreate() {
    this.state = new WorldState();

    this.onMessage("ping", (client, payload: unknown) => {
      const msg = parseClientMessage("ping", payload);
      if (!msg.ok || msg.type !== "ping") return this.reject(client, msg.ok ? "bad type" : msg.reason);
      client.send("pong", { n: msg.data.n });
    });

    // Any message type we don't know about is refused.
    this.onMessage("*", (client, type) => {
      this.reject(client, `unknown message type: ${String(type).slice(0, 32)}`);
    });
  }

  override onJoin(_client: Client) {
    this.state.playerCount = this.clients.length;
  }

  override onLeave(_client: Client) {
    this.state.playerCount = this.clients.length;
  }

  /** Tell the client its message was refused. Repeat offenders get disconnected in later tasks. */
  private reject(client: Client, reason: string) {
    client.send("rejected", { reason });
  }
}
