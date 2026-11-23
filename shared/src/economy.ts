import { z } from "zod";

/**
 * Economy rules (GAME_SPEC §13). The server decides every coin change; each one
 * is written to an append-only economy log inside the same transaction.
 */

/** "A traveller at the Crossroads Inn with a few coins." */
export const STARTING_COINS = 20;
/** One night at the inn: lasts one world day (2 real hours); paying again extends it. */
export const ROOM_PRICE = 5;
/** Largest single chest deposit/withdrawal (keeps messages small and sane). */
export const MAX_COIN_MOVE = 100_000;
/** How close (world pixels) you must be to talk to someone or use something. */
export const INTERACT_RANGE = 40;

export interface Wallet {
  coins: number;
  chest: number;
  /** Epoch ms until which the inn room is yours (0 = no room). */
  roomUntil: number;
  /** Bed you wake up in while your room is rented. */
  restPoint: string | null;
}


/** Things in the map you can use or talk to are named map points (lowercase). */
export const PointName = z.string().regex(/^[a-z][a-z0-9_]{0,23}$/);
export const InteractMessage = z.object({ target: PointName }).strict();
export const RestMessage = z.object({ point: PointName }).strict();
export const ChestMessage = z
  .object({ amount: z.number().int().min(-MAX_COIN_MOVE).max(MAX_COIN_MOVE).refine((n) => n !== 0) })
  .strict();

/** The bard's songs (same order as the tavern music tracks on the client). */
export const BARD_SONGS = ["The Old Tower Inn", "Crowded Pub"] as const;
/** Tip for the bard to play a song. */
export const SONG_PRICE = 1;
export const SongRequestMessage = z.object({ song: z.number().int().min(0).max(BARD_SONGS.length - 1) }).strict();
