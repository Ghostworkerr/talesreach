/**
 * Movement rules shared by server and client.
 * The server is the only one whose result counts; the client uses the same
 * function to predict its own movement.
 */
import { feetBlocked, type CollisionGrid } from "./map.js";

/** Walking speed in pixels per second. */
export const PLAYER_SPEED = 96;

/** World size in pixels when no map is given (matches the Crossroads map: 40 x 30 tiles). */
export const WORLD_WIDTH = 640;
export const WORLD_HEIGHT = 480;

/** Radius of a character, used to keep it inside the world. */
export const PLAYER_RADIUS = 8;

export interface Vec2 {
  x: number;
  y: number;
}

/** Clamp a direction so its length is at most 1 (no faster diagonal, no speed hacks). */
export function clampDirection(dir: Vec2): Vec2 {
  const x = Number.isFinite(dir.x) ? dir.x : 0;
  const y = Number.isFinite(dir.y) ? dir.y : 0;
  const len = Math.hypot(x, y);
  if (len <= 1) return { x, y };
  return { x: x / len, y: y / len };
}

/**
 * Move a position by a direction for dt seconds. Stays inside the world, and
 * with a collision grid it stops at walls — sliding along them (x and y are
 * tried separately), so brushing a wall at an angle doesn't stop you dead.
 */
export function stepMovement(pos: Vec2, dir: Vec2, dtSeconds: number, grid?: CollisionGrid): Vec2 {
  const d = clampDirection(dir);
  const dt = Math.min(Math.max(dtSeconds, 0), 0.25);
  const width = grid ? grid.width * grid.tile : WORLD_WIDTH;
  const height = grid ? grid.height * grid.tile : WORLD_HEIGHT;
  const nx = clamp(pos.x + d.x * PLAYER_SPEED * dt, PLAYER_RADIUS, width - PLAYER_RADIUS);
  const ny = clamp(pos.y + d.y * PLAYER_SPEED * dt, PLAYER_RADIUS, height - PLAYER_RADIUS);
  if (!grid) return { x: nx, y: ny };
  // If we're somehow already inside something (e.g. spawned there), let the player walk out.
  if (feetBlocked(grid, pos.x, pos.y)) return { x: nx, y: ny };
  const x = feetBlocked(grid, nx, pos.y) ? pos.x : nx;
  const y = feetBlocked(grid, x, ny) ? pos.y : ny;
  return { x, y };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
