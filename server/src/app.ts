import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GAME_NAME, MAX_MESSAGE_BYTES, WORLD_ROOM } from "@talesreach/shared";
import { WorldRoom } from "./rooms/WorldRoom.js";

export interface GameServerOptions {
  /** Print the Colyseus banner on start. */
  greet?: boolean;
}

/** Build the game server (not yet listening). Used by index.ts and by tests. */
export function createGameServer(opts: GameServerOptions = {}): Server {
  const server = new Server({
    greet: opts.greet ?? false,
    transport: new WebSocketTransport({
      // Oversized websocket frames are refused by the socket layer itself.
      maxPayload: MAX_MESSAGE_BYTES,
    }),
    express: (app) => {
      app.get("/health", (_req, res) => {
        res.json({ ok: true, game: GAME_NAME });
      });
    },
  });

  server.define(WORLD_ROOM, WorldRoom);
  return server;
}
