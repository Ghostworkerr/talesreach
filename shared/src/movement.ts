/**
 * Movement rules shared by server and client.
 * The server is the only one whose result counts; the client may use the
 * same function later to predict its own movement (task 0.3).
 */

/** Walking speed in pixels per second. */
export const PLAYER_SPEED = 96;

/** Placeholder world size in pixels until the real map arrives (task 1.2). */
export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 640;

/** Radius of the placeholder character, used to keep it inside the world. */
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

/** Move a position by a direction for dt seconds, staying inside the world. */
export function stepMovement(pos: Vec2, dir: Vec2, dtSeconds: number): Vec2 {
  const d = clampDirection(dir);
  const dt = Math.min(Math.max(dtSeconds, 0), 0.25);
  return {
    x: clamp(pos.x + d.x * PLAYER_SPEED * dt, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS),
    y: clamp(pos.y + d.y * PLAYER_SPEED * dt, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS),
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
