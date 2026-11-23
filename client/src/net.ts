import { Client, type Room } from "@colyseus/sdk";
import { DEFAULT_SERVER_PORT, WORLD_ROOM } from "@talesreach/shared";

/** Server address: VITE_SERVER_URL in production, otherwise the same host on the game port. */
export function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:${DEFAULT_SERVER_PORT}`;
}

/** How long to keep trying while a sleeping free-tier server wakes up. */
const WAKE_TIMEOUT_MS = 150_000;
const RETRY_EVERY_MS = 3_000;

/**
 * Join the world. Free hosting puts the server to sleep when nobody plays,
 * and waking it takes up to about a minute, so keep retrying and report progress.
 */
export async function joinWorld(onWaiting?: (secondsWaited: number) => void): Promise<Room> {
  const client = new Client(serverUrl());
  const started = Date.now();
  for (;;) {
    try {
      return await client.joinOrCreate(WORLD_ROOM);
    } catch (err) {
      const waited = Date.now() - started;
      if (waited > WAKE_TIMEOUT_MS) throw err;
      onWaiting?.(Math.round(waited / 1000));
      await new Promise((r) => setTimeout(r, RETRY_EVERY_MS));
    }
  }
}
