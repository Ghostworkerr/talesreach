import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEET, feetBlocked, findPath, isBlockedTile, parseTiledMap, stepMovement, zoneAt } from "@talesreach/shared";

const raw = JSON.parse(readFileSync(new URL("../assets/maps/crossroads.tmj", import.meta.url), "utf8"));
const map = parseTiledMap(raw);
const T = map.grid.tile;
const centre = (tx: number, ty: number) => ({ x: tx * T + T / 2, y: ty * T + T / 2 });

describe("Crossroads map", () => {
  it("loads with collision, spawns, NPC spots and zones", () => {
    expect(map.name).toBe("The Crossroads Inn");
    expect(map.grid.width).toBe(40);
    expect(map.grid.height).toBe(30);
    expect(map.points.filter((p) => p.type === "spawn").length).toBeGreaterThanOrEqual(2);
    expect(map.points.map((p) => p.name)).toEqual(expect.arrayContaining(["innkeeper", "server", "bard"]));
    expect(zoneAt(map, centre(20, 10).x, centre(20, 10).y)?.props.mood).toBe("tavern");
    expect(zoneAt(map, centre(20, 22).x, centre(20, 22).y)?.props.mood).toBe("day");
  });

  it("spawn points are on open floor", () => {
    for (const p of map.points.filter((pt) => pt.type === "spawn")) expect(feetBlocked(map.grid, p.x, p.y)).toBe(false);
  });

  it("walls are solid and the front door is open", () => {
    expect(isBlockedTile(map.grid, 4, 10)).toBe(true); // west outer wall
    expect(isBlockedTile(map.grid, 19, 16)).toBe(false); // front door
    expect(isBlockedTile(map.grid, 20, 17)).toBe(false);
    expect(isBlockedTile(map.grid, -1, 5)).toBe(true); // outside the map
  });

  it("walking into a wall stops at the wall (and slides along it)", () => {
    let pos = centre(19, 14);
    for (let i = 0; i < 200; i++) pos = stepMovement(pos, { x: 0, y: -1 }, 0.05, map.grid);
    // The hall's north wall face ends at row 3, so feet stop just below it.
    expect(pos.y).toBeGreaterThanOrEqual(4 * T + FEET.up);
    expect(pos.y).toBeLessThan(5 * T);
    const before = pos.x;
    for (let i = 0; i < 10; i++) pos = stepMovement(pos, { x: 0.7, y: -0.7 }, 0.05, map.grid);
    expect(pos.x).toBeGreaterThan(before); // slid sideways along the wall
  });
});

describe("tap-to-move routes", () => {
  const walkable = (path: { x: number; y: number }[]) =>
    path.every((p) => !isBlockedTile(map.grid, Math.floor(p.x / T), Math.floor(p.y / T)));

  it("finds a way from the hall into a bedroom through its doorway", () => {
    const path = findPath(map.grid, centre(19, 14), centre(8, 5));
    expect(path.length).toBeGreaterThan(5);
    expect(walkable(path)).toBe(true);
    expect(path.some((p) => Math.floor(p.x / T) === 12)).toBe(true); // through the doorway in the x=12 wall
  });

  it("goes out of the front door to the crossroads", () => {
    const path = findPath(map.grid, centre(19, 14), centre(30, 24));
    expect(walkable(path)).toBe(true);
    expect(path.some((p) => Math.floor(p.y / T) === 17 && [19, 20].includes(Math.floor(p.x / T)))).toBe(true);
  });

  it("tapping on a wall or table heads for the nearest open spot", () => {
    const path = findPath(map.grid, centre(19, 14), centre(16, 9)); // a table
    expect(path.length).toBeGreaterThan(0);
    const end = path[path.length - 1]!;
    expect(isBlockedTile(map.grid, Math.floor(end.x / T), Math.floor(end.y / T))).toBe(false);
  });

  it("returns nothing for unreachable places and stays bounded", () => {
    const sealed = { width: 5, height: 5, tile: 16, blocked: new Uint8Array(25).fill(1) };
    sealed.blocked[0] = 0;
    expect(findPath(sealed, { x: 8, y: 8 }, { x: 72, y: 72 })).toEqual([]);
  });
});
