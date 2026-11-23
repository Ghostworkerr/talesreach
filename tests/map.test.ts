import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHUNK_TILES, FEET, doorAt, feetBlocked, findPath, isBlockedTile, parseTiledMap, stepMovement, zoneAt, type GameMap } from "@talesreach/shared";
// @ts-expect-error plain JS build tool (no type declarations)
import { chunkMap } from "../tools/maps/build-chunks.mjs";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../assets/maps/${name}.tmj`, import.meta.url), "utf8"));
const inn = parseTiledMap(read("inn"));
const region = parseTiledMap(read("crossroads"));
const T = inn.grid.tile;
const centre = (tx: number, ty: number) => ({ x: tx * T + T / 2, y: ty * T + T / 2 });
const point = (map: GameMap, name: string) => map.points.find((p) => p.name === name)!;

describe("the inn (interior map)", () => {
  it("loads with collision, spawns, NPC spots and zones", () => {
    expect(inn.name).toBe("The Crossroads Inn");
    expect(inn.grid.width).toBe(40);
    expect(inn.grid.height).toBe(20);
    expect(inn.points.filter((p) => p.type === "spawn").length).toBeGreaterThanOrEqual(2);
    expect(inn.points.map((p) => p.name)).toEqual(expect.arrayContaining(["innkeeper", "server", "bard", "inn_entry"]));
    expect(zoneAt(inn, centre(20, 10).x, centre(20, 10).y)?.props.mood).toBe("tavern");
  });

  it("spawn and arrival points are on open floor", () => {
    for (const p of inn.points.filter((pt) => pt.type === "spawn" || pt.type === "arrival")) expect(feetBlocked(inn.grid, p.x, p.y)).toBe(false);
  });

  it("walls are solid, outside the walls is solid, and the doorway is open", () => {
    expect(isBlockedTile(inn.grid, 4, 10)).toBe(true); // west outer wall
    expect(isBlockedTile(inn.grid, 1, 1)).toBe(true); // outside the building
    expect(isBlockedTile(inn.grid, 19, 17)).toBe(false); // doorway
    expect(isBlockedTile(inn.grid, -1, 5)).toBe(true); // off the map
  });

  it("walking into a wall stops at the wall (and slides along it)", () => {
    let pos = centre(19, 14);
    for (let i = 0; i < 200; i++) pos = stepMovement(pos, { x: 0, y: -1 }, 0.05, inn.grid);
    expect(pos.y).toBeGreaterThanOrEqual(4 * T + FEET.up);
    expect(pos.y).toBeLessThan(5 * T);
    const before = pos.x;
    for (let i = 0; i < 10; i++) pos = stepMovement(pos, { x: 0.7, y: -0.7 }, 0.05, inn.grid);
    expect(pos.x).toBeGreaterThan(before);
  });
});

describe("the Crossroads region", () => {
  it("is a 128 x 128 open world with named areas", () => {
    expect(region.name).toBe("The Crossroads");
    expect(region.grid.width).toBe(128);
    expect(region.grid.height).toBe(128);
    const names = region.zones.map((z) => z.props.name);
    expect(names).toEqual(expect.arrayContaining(["Crossroads", "Whisperwood", "Ancient Grove", "Brightfield Farms", "Fenmarsh Edge"]));
    const grove = point(region, "grove_heart");
    expect(zoneAt(region, grove.x, grove.y)?.props.name).toBe("Ancient Grove");
  });

  it("you can walk from the inn's front step to the forest, the farms and the town square", () => {
    const front = point(region, "inn_front");
    expect(feetBlocked(region.grid, front.x, front.y)).toBe(false);
    for (const goal of ["grove_heart", "farm_gate", "well_square"]) {
      const route = findPath(region.grid, front, point(region, goal), 40_000);
      expect(route.length, goal).toBeGreaterThan(0);
    }
  });
});

describe("doors", () => {
  const maps: Record<string, GameMap> = { inn, crossroads: region };

  it("every door leads to a real arrival point that is open floor and not itself a door", () => {
    for (const [name, map] of Object.entries(maps)) {
      const doors = map.zones.filter((z) => z.type === "door");
      expect(doors.length, name).toBeGreaterThan(0);
      for (const z of doors) {
        const d = doorAt(map, z.x + 1, z.y + 1)!;
        const target = maps[d.to]!;
        const spot = point(target, d.spot);
        expect(spot, `${name} → ${d.to}:${d.spot}`).toBeTruthy();
        expect(feetBlocked(target.grid, spot.x, spot.y)).toBe(false);
        expect(doorAt(target, spot.x, spot.y)).toBeUndefined(); // no endless door loop
      }
    }
  });

  it("the inn's doorway can be reached from inside, and the inn door from outside", () => {
    const exit = inn.zones.find((z) => z.type === "door")!;
    expect(findPath(inn.grid, point(inn, "inn_entry"), { x: exit.x + 8, y: exit.y + 8 }).length).toBeGreaterThan(0);
    const door = region.zones.find((z) => z.type === "door")!;
    expect(isBlockedTile(region.grid, Math.floor(door.x / T), Math.floor(door.y / T))).toBe(false);
    expect(findPath(region.grid, point(region, "inn_front"), { x: door.x + 8, y: door.y + 8 }).length).toBeGreaterThan(0);
  });

  it("door zones are not music/area zones", () => {
    const door = region.zones.find((z) => z.type === "door")!;
    expect(zoneAt(region, door.x + 1, door.y + 1)?.type).toBe("zone");
  });
});

describe("chunks (the client streams maps in pieces)", () => {
  it("the chunk files match the maps (rebuild with tools/maps/build-chunks.mjs)", () => {
    for (const name of ["inn", "crossroads"]) {
      const { meta, chunks } = chunkMap(read(name)) as { meta: unknown; chunks: Map<string, unknown> };
      const onDisk = (file: string) => JSON.parse(readFileSync(new URL(`../assets/maps/${name}/${file}`, import.meta.url), "utf8"));
      expect(onDisk("meta.json")).toEqual(meta);
      for (const [key, chunk] of chunks) expect(onDisk(`${key}.json`), `${name} ${key}`).toEqual(chunk);
    }
  });

  it("the meta file keeps collision and places but no drawn tiles", () => {
    const meta = JSON.parse(readFileSync(new URL("../assets/maps/crossroads/meta.json", import.meta.url), "utf8"));
    const parsed = parseTiledMap(meta);
    expect(parsed.grid.blocked).toEqual(region.grid.blocked);
    expect(parsed.points).toEqual(region.points);
    expect(meta.layers.some((l: { name: string }) => l.name === "Ground")).toBe(false);
    expect(Math.ceil(128 / CHUNK_TILES) ** 2).toBe(16);
  });
});

describe("tap-to-move routes", () => {
  const walkable = (path: { x: number; y: number }[]) =>
    path.every((p) => !isBlockedTile(inn.grid, Math.floor(p.x / T), Math.floor(p.y / T)));

  it("finds a way from the hall into a bedroom through its doorway", () => {
    const path = findPath(inn.grid, centre(19, 14), centre(8, 5));
    expect(path.length).toBeGreaterThan(5);
    expect(walkable(path)).toBe(true);
    expect(path.some((p) => Math.floor(p.x / T) === 12)).toBe(true);
  });

  it("tapping on a wall or table heads for the nearest open spot", () => {
    const path = findPath(inn.grid, centre(19, 14), centre(16, 9));
    expect(path.length).toBeGreaterThan(0);
    const end = path[path.length - 1]!;
    expect(isBlockedTile(inn.grid, Math.floor(end.x / T), Math.floor(end.y / T))).toBe(false);
  });

  it("returns nothing for unreachable places and stays bounded", () => {
    const sealed = { width: 5, height: 5, tile: 16, blocked: new Uint8Array(25).fill(1) };
    sealed.blocked[0] = 0;
    expect(findPath(sealed, { x: 8, y: 8 }, { x: 72, y: 72 })).toEqual([]);
  });
});
