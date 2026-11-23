/** Game-wide constants shared by server and client. */

export const GAME_NAME = "Talesreach";

/** Name of the first Colyseus room (one room per region later). */
export const WORLD_ROOM = "world";

/** Server simulation ticks per second. */
export const TICK_RATE = 20;

/** Tile size in pixels. Final value is set by the art pack chosen in task 0.4. */
export const TILE_SIZE = 16;

/** Hard cap on any single client→server message, in bytes (before parsing). */
export const MAX_MESSAGE_BYTES = 1024;

/** Per-connection rate limit: at most this many messages per second. */
export const MAX_MESSAGES_PER_SECOND = 30;

/** Default port the game server listens on. */
export const DEFAULT_SERVER_PORT = 2567;

/** Interest management: a client receives players/NPCs within this many pixels (and on its map). */
export const VIEW_RANGE = 420;
/** ...and keeps them until they are this far away (no flicker at the edge). */
export const VIEW_RANGE_LEAVE = 500;

/** The open world is streamed to clients in square chunks of this many tiles. */
export const CHUNK_TILES = 32;

/** The map new characters start in (the Crossroads Inn, inside). */
export const START_MAP = "inn";
/** Maps the world room serves. */
export const WORLD_MAPS = ["inn", "crossroads"] as const;
export type WorldMapName = (typeof WORLD_MAPS)[number];
