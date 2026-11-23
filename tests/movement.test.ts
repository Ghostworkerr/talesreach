import { describe, expect, it } from "vitest";
import {
  PLAYER_RADIUS,
  PLAYER_SPEED,
  WORLD_WIDTH,
  clampDirection,
  parseClientMessage,
  stepMovement,
} from "@talesreach/shared";

describe("input message schema", () => {
  it("accepts a direction", () => {
    expect(parseClientMessage("input", { x: 1, y: -0.5 }).ok).toBe(true);
  });

  it("rejects positions, out-of-range values and garbage", () => {
    for (const bad of [
      { x: 500, y: 300 }, // a position, not a direction
      { x: 2, y: 0 },
      { x: 0, y: -1.01 },
      { x: Number.NaN, y: 0 },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: "1", y: 0 },
      { x: 1 },
      { x: 1, y: 0, teleportTo: { x: 0, y: 0 } },
      [1, 0],
      null,
    ]) {
      expect(parseClientMessage("input", bad).ok).toBe(false);
    }
  });
});

describe("movement rules", () => {
  it("never lets a direction be longer than 1", () => {
    const d = clampDirection({ x: 1, y: 1 });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  });

  it("moves at walking speed and no faster", () => {
    const next = stepMovement({ x: 100, y: 100 }, { x: 1, y: 1 }, 0.25);
    expect(Math.hypot(next.x - 100, next.y - 100)).toBeCloseTo(PLAYER_SPEED * 0.25);
  });

  it("caps a huge time step so a lag spike can't fling a player", () => {
    const next = stepMovement({ x: 100, y: 100 }, { x: 1, y: 0 }, 60);
    expect(next.x - 100).toBeLessThanOrEqual(PLAYER_SPEED * 0.25 + 1e-9);
  });

  it("keeps players inside the world", () => {
    const next = stepMovement({ x: WORLD_WIDTH - 1, y: 100 }, { x: 1, y: 0 }, 0.25);
    expect(next.x).toBe(WORLD_WIDTH - PLAYER_RADIUS);
  });
});
