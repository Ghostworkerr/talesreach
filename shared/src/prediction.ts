import { stepMovement, type Vec2 } from "./movement.js";
import type { CollisionGrid } from "./map.js";
import { TICK_RATE } from "./constants.js";

/** Each input message moves the player for exactly one server tick. */
export const MOVE_STEP_SECONDS = 1 / TICK_RATE;

/** Most inputs the server will hold for one player; extras are dropped (anti speed hack). */
export const MAX_QUEUED_INPUTS = 4;

/** Highest sequence number a client may use. */
export const MAX_INPUT_SEQ = 2 ** 31 - 1;

export interface PendingInput {
  seq: number;
  x: number;
  y: number;
}

/** Apply one input exactly the way the server does. */
export function applyInput(pos: Vec2, input: Vec2, grid?: CollisionGrid): Vec2 {
  return stepMovement(pos, input, MOVE_STEP_SECONDS, grid);
}

/**
 * Client-side prediction for your own character.
 * You move instantly on your own screen; when the server's answer arrives,
 * we restart from the server's position and replay inputs it hasn't seen yet.
 */
export class Predictor {
  private pending: PendingInput[] = [];
  private nextSeq = 1;
  position: Vec2;

  constructor(
    start: Vec2,
    private readonly grid?: CollisionGrid,
  ) {
    this.position = { ...start };
  }

  /** Record a new input, move locally, and return the message to send. */
  push(dir: Vec2): PendingInput {
    const input = { seq: this.nextSeq++, x: dir.x, y: dir.y };
    this.pending.push(input);
    // Never keep more than a few seconds of unacknowledged inputs.
    if (this.pending.length > TICK_RATE * 5) this.pending.shift();
    this.position = applyInput(this.position, input, this.grid);
    return input;
  }

  /** The server says: you are at `server`, and I have processed inputs up to `ack`. */
  reconcile(server: Vec2, ack: number): Vec2 {
    this.pending = this.pending.filter((i) => i.seq > ack);
    let pos: Vec2 = { x: server.x, y: server.y };
    for (const i of this.pending) pos = applyInput(pos, i, this.grid);
    const correction = { x: pos.x - this.position.x, y: pos.y - this.position.y };
    this.position = pos;
    return correction;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

/**
 * Smooths other players' movement: we draw them slightly in the past and
 * blend between the two server snapshots either side of that moment.
 */
export class Interpolator {
  private snaps: { t: number; x: number; y: number }[] = [];

  constructor(private readonly delayMs = 100) {}

  add(t: number, pos: Vec2) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && last.t >= t) return;
    this.snaps.push({ t, x: pos.x, y: pos.y });
    if (this.snaps.length > 20) this.snaps.shift();
  }

  sample(now: number): Vec2 | null {
    const target = now - this.delayMs;
    const s = this.snaps;
    if (s.length === 0) return null;
    const first = s[0]!;
    if (target <= first.t) return { x: first.x, y: first.y };
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (target >= a.t) {
        if (target >= b.t) return { x: b.x, y: b.y };
        const k = (target - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return { x: first.x, y: first.y };
  }
}
