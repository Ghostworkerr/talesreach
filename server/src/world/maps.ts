import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTiledMap, type GameMap } from "@talesreach/shared";

/** Maps live in the repo's assets/maps (same files the client draws). */
const MAPS_DIR = fileURLToPath(new URL("../../../assets/maps/", import.meta.url));

const cache = new Map<string, GameMap>();

/** Load and parse a Tiled map once; the server uses it for collision and spawns. */
export function loadMap(name: string): GameMap {
  const hit = cache.get(name);
  if (hit) return hit;
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("bad map name");
  const map = parseTiledMap(JSON.parse(readFileSync(`${MAPS_DIR}${name}.tmj`, "utf8")));
  cache.set(name, map);
  return map;
}

export const START_MAP = "crossroads";
