import { Client } from "@colyseus/sdk";
import { DEFAULT_SERVER_PORT, WORLD_ROOM } from "@talesreach/shared";

/** Server address: VITE_SERVER_URL in production, otherwise the same host on the game port. */
export function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:${DEFAULT_SERVER_PORT}`;
}

export async function joinWorld() {
  const client = new Client(serverUrl());
  return client.joinOrCreate(WORLD_ROOM);
}
