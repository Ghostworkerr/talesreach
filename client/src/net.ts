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

/** True when the server refused our login (unknown token or not allowed). */
export function isAuthError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 401 || code === 403;
}

/**
 * Join the world. Free hosting puts the server to sleep when nobody plays,
 * and waking it takes up to about a minute, so keep retrying and report progress.
 */
export async function joinWorld(token: string, onWaiting?: (secondsWaited: number) => void): Promise<Room> {
  const client = new Client(serverUrl());
  const started = Date.now();
  for (;;) {
    try {
      return await client.joinOrCreate(WORLD_ROOM, { token });
    } catch (err) {
      if (isAuthError(err)) throw err; // not a sleeping server: our login was refused
      const waited = Date.now() - started;
      if (waited > WAKE_TIMEOUT_MS) throw err;
      onWaiting?.(Math.round(waited / 1000));
      await new Promise((r) => setTimeout(r, RETRY_EVERY_MS));
    }
  }
}

/** Wait until the server answers its health check (it may be waking from sleep). */
export async function wakeServer(onWaiting?: (secondsWaited: number) => void): Promise<void> {
  const url = `${serverUrl().replace(/^ws/, "http").replace(/\/$/, "")}/health`;
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return;
    } catch {
      // asleep or unreachable: keep waiting
    }
    const waited = Date.now() - started;
    if (waited > WAKE_TIMEOUT_MS) throw new Error("server unreachable");
    onWaiting?.(Math.round(waited / 1000));
    await new Promise((r) => setTimeout(r, RETRY_EVERY_MS));
  }
}
