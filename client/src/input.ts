import Phaser from "phaser";
import type { Vec2 } from "@talesreach/shared";
import { DPR } from "./display";

/** Sizes in CSS pixels, converted to real screen pixels (the canvas draws at screen density). */
const JOYSTICK_RADIUS = 56 * DPR;
const KNOB_RADIUS = 24 * DPR;
const DEAD_ZONE = 8 * DPR;
/** A press counts as a tap if it is short and barely moves. */
const TAP_MAX_MS = 350;
const TAP_MAX_MOVE = 14 * DPR;

/**
 * Turns WASD / arrow keys (PC) and a virtual joystick (phone) into a walking
 * direction. The joystick appears wherever the player first touches the left
 * half of the screen and follows their thumb.
 *
 * Tap-to-move: a quick tap on the right half (phone) or a click anywhere (PC)
 * reports a screen point; the world scene walks you there.
 */
export class MoveInput {
  private keys: Record<"w" | "a" | "s" | "d" | "up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key> | null;
  private pointerId: number | null = null;
  private origin = new Phaser.Math.Vector2();
  private stick: Vec2 = { x: 0, y: 0 };
  private base: Phaser.GameObjects.Arc;
  private knob: Phaser.GameObjects.Arc;
  private presses = new Map<number, { x: number; y: number; t: number }>();
  private tapListeners = new Set<(screenX: number, screenY: number) => void>();

  constructor(private readonly scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    this.keys = kb
      ? (kb.addKeys({
          w: "W", a: "A", s: "S", d: "D",
          up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT",
        }) as MoveInput["keys"])
      : null;

    this.base = scene.add.circle(0, 0, JOYSTICK_RADIUS, 0xffffff, 0.12).setStrokeStyle(2 * DPR, 0xffffff, 0.35);
    this.knob = scene.add.circle(0, 0, KNOB_RADIUS, 0xffffff, 0.35);
    for (const o of [this.base, this.knob]) o.setScrollFactor(0).setDepth(1000).setVisible(false);

    scene.input.addPointer(2);
    scene.input.on("pointerdown", this.onDown, this);
    scene.input.on("pointermove", this.onMove, this);
    scene.input.on("pointerup", this.onUp, this);
    scene.input.on("pointerupoutside", this.onUp, this);
  }

  /** Called with the screen point of each tap/click meant as "walk there". */
  onTap(fn: (screenX: number, screenY: number) => void) {
    this.tapListeners.add(fn);
    return () => this.tapListeners.delete(fn);
  }

  /** Current direction, each axis in -1..1, length at most 1. */
  direction(): Vec2 {
    if (this.pointerId !== null) return this.stick;
    const k = this.keys;
    if (!k) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    if (k.a.isDown || k.left.isDown) x -= 1;
    if (k.d.isDown || k.right.isDown) x += 1;
    if (k.w.isDown || k.up.isDown) y -= 1;
    if (k.s.isDown || k.down.isDown) y += 1;
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    return { x, y };
  }

  private onDown(p: Phaser.Input.Pointer) {
    this.presses.set(p.id, { x: p.x, y: p.y, t: performance.now() });
    // Mice never get a joystick (clicks are tap-to-move); thumbs on the left half do.
    if (!p.wasTouch || this.pointerId !== null || p.x > this.scene.scale.width / 2) return;
    this.pointerId = p.id;
    this.origin.set(p.x, p.y);
    this.base.setPosition(p.x, p.y).setVisible(true);
    this.knob.setPosition(p.x, p.y).setVisible(true);
    this.stick = { x: 0, y: 0 };
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (p.id !== this.pointerId) return;
    const dx = p.x - this.origin.x;
    const dy = p.y - this.origin.y;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, JOYSTICK_RADIUS);
    const nx = len > 0 ? dx / len : 0;
    const ny = len > 0 ? dy / len : 0;
    this.knob.setPosition(this.origin.x + nx * clamped, this.origin.y + ny * clamped);
    // Small dead zone so a resting thumb doesn't drift.
    const strength = clamped < DEAD_ZONE ? 0 : clamped / JOYSTICK_RADIUS;
    this.stick = { x: round(nx * strength), y: round(ny * strength) };
  }

  private onUp(p: Phaser.Input.Pointer) {
    const press = this.presses.get(p.id);
    this.presses.delete(p.id);
    // A short press that barely moved, and not the joystick's finger, means "walk there".
    const isTap =
      press !== undefined &&
      p.id !== this.pointerId &&
      performance.now() - press.t < TAP_MAX_MS &&
      Math.hypot(p.x - press.x, p.y - press.y) < TAP_MAX_MOVE;
    if (isTap) for (const fn of this.tapListeners) fn(press.x, press.y);
    if (p.id !== this.pointerId) return;
    this.pointerId = null;
    this.stick = { x: 0, y: 0 };
    this.base.setVisible(false);
    this.knob.setVisible(false);
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
