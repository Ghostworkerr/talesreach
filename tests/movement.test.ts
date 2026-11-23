import { describe, expect, it } from "vitest";
import {
  Interpolator,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  Predictor,
  WORLD_WIDTH,
  applyInput,
  clampDirection,
  parseClientMessage,
  stepMovement,
} from "@talesreach/shared";

describe("input message schema", () => {
  it("accepts a direction with a sequence number", () => {
    expect(parseClientMessage("input", { seq: 1, x: 1, y: -0.5 }).ok).toBe(true);
  });

  it("rejects positions, out-of-range values and garbage", () => {
    for (const bad of [
      { seq: 1, x: 500, y: 300 }, // a position, not a direction
      { seq: 1, x: 2, y: 0 },
      { seq: 1, x: 0, y: -1.01 },
      { seq: 1, x: Number.NaN, y: 0 },
      { seq: 1, x: Number.POSITIVE_INFINITY, y: 0 },
      { seq: 1, x: "1", y: 0 },
      { seq: 1, x: 1 },
      { x: 1, y: 0 }, // no sequence number
      { seq: 0, x: 1, y: 0 },
      { seq: 1.5, x: 1, y: 0 },
      { seq: 1, x: 1, y: 0, teleportTo: { x: 0, y: 0 } },
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

describe("prediction and smoothing", () => {
  it("prediction matches the server when nothing is lost", () => {
    const p = new Predictor({ x: 100, y: 100 });
    let server = { x: 100, y: 100 };
    const inputs = [p.push({ x: 1, y: 0 }), p.push({ x: 1, y: 0 }), p.push({ x: 0, y: 1 })];
    // The server has applied the first two so far.
    for (const i of inputs.slice(0, 2)) server = applyInput(server, i);
    const fix = p.reconcile(server, 2);
    expect(fix.x).toBeCloseTo(0);
    expect(fix.y).toBeCloseTo(0);
    expect(p.pendingCount).toBe(1);
  });

  it("goes back to the server's answer when the server disagrees", () => {
    const p = new Predictor({ x: 100, y: 100 });
    p.push({ x: 1, y: 0 });
    // The server says you didn't move (for example, that input was dropped).
    const fix = p.reconcile({ x: 100, y: 100 }, 1);
    expect(p.position).toEqual({ x: 100, y: 100 });
    expect(fix.x).toBeLessThan(0);
  });

  it("blends between snapshots for other players", () => {
    const interp = new Interpolator(100);
    interp.add(1000, { x: 0, y: 0 });
    interp.add(1100, { x: 10, y: 0 });
    expect(interp.sample(1150)).toEqual({ x: 5, y: 0 });
    expect(interp.sample(5000)).toEqual({ x: 10, y: 0 });
    expect(interp.sample(0)).toEqual({ x: 0, y: 0 });
  });
});
