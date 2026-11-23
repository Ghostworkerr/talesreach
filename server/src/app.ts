import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_NAME, MAX_MESSAGE_BYTES, WORLD_ROOM } from "@talesreach/shared";
import { WorldRoom } from "./rooms/WorldRoom.js";
import type { AccountStore } from "./db/store.js";
import { setAccountStore } from "./services.js";
import { accountRoutes, type RateLimits } from "./http/accounts.js";

export interface GameServerOptions {
  /** Where player accounts live (real Postgres in production, in-memory in dev/tests). */
  store: AccountStore;
  /** Print the Colyseus banner on start. */
  greet?: boolean;
  /** Per-IP request limits for the account API (tests raise them). */
  rateLimits?: RateLimits;
}

/** Build the game server (not yet listening). Used by index.ts and by tests. */
export function createGameServer(opts: GameServerOptions): Server {
  setAccountStore(opts.store);
  const server = new Server({
    greet: opts.greet ?? false,
    transport: new WebSocketTransport({
      // Oversized websocket frames are refused by the socket layer itself.
      maxPayload: MAX_MESSAGE_BYTES,
    }),
    express: (app) => {
      // Behind Render's proxy: use the real client address for rate limits.
      app.set("trust proxy", 1);
      app.get("/health", (_req, res) => {
        res.json({ ok: true, game: GAME_NAME });
      });
      accountRoutes(app, opts.rateLimits);
    },
  });

  server.define(WORLD_ROOM, WorldRoom);
  return server;
}
