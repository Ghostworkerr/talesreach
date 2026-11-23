import Phaser from "phaser";
import { WORLD_ZOOM } from "./display";

/**
 * A character drawn as paper-doll pieces cut from one 16x16 image, so it can be
 * animated in code (the Kenney pack has no walk frames). Every offset is a whole
 * art pixel, so the pixel art stays crisp.
 *
 * Piece layout inside the 16x16 image (x, y, width, height):
 */
export const PIECES = {
  body: [3, 0, 10, 14],
  armL: [0, 6, 3, 8],
  armR: [13, 6, 3, 8],
  // Feet overlap the body's last row and are drawn in front, so steps are clearly visible.
  footL: [0, 13, 8, 3],
  footR: [8, 13, 8, 3],
} as const;
export type PieceName = keyof typeof PIECES;
/** Draw order, back to front. */
export const DRAW_ORDER: readonly PieceName[] = ["body", "armL", "armR", "footL", "footR"];
/** How far (art pixels) the swinging foot reaches forward/back when walking sideways. */
const REACH = 2;

/** Distance walked per full stride (two steps), in world pixels. */
const STRIDE = 32;
/** After this long without moving, the character settles into idle. */
const STOP_AFTER_MS = 90;
/** Idle breathing: one gentle dip every this many ms. */
export const BREATH_EVERY_MS = 2400;
const BREATH_DIP_MS = 450;
/** Sprite centre sits 4px above the character's ground point. */
const BODY_Y = -4;

const DUST_COLOUR = 0xd9caa9;

export type Pose = Record<PieceName, readonly [number, number]>;

/**
 * Walk pose for a point in the stride (phase 0..1, two steps per stride).
 * One foot swings (lifts up to 2px and, walking sideways, moves back to front)
 * while the other stays planted and slides back; the opposite arm swings up and
 * the body rises at mid-step. Shared by the world and the creator preview.
 */
export function walkPose(phase: number, sideways: boolean): Pose {
  const half = phase < 0.5 ? 0 : 1;
  const t = (phase * 2) % 1;
  const reach = sideways ? REACH : 0;
  const swingX = Math.round(-reach + 2 * reach * t);
  const plantX = -Math.round(swingX / 2);
  const swingY = t < 0.15 || t > 0.85 ? 0 : t < 0.3 || t > 0.7 ? -1 : -2;
  const bob = t > 0.3 && t < 0.7 ? -1 : 0;
  const armLift = t > 0.15 && t < 0.85 ? -1 : 0;
  const swing = half === 0 ? "footL" : "footR";
  const armUp = half === 0 ? "armR" : "armL";
  const pose: Record<PieceName, [number, number]> = {
    body: [0, bob],
    armL: [0, bob],
    armR: [0, bob],
    footL: [0, 0],
    footR: [0, 0],
  };
  pose[swing] = [swingX, swingY];
  pose[swing === "footL" ? "footR" : "footL"] = [plantX, 0];
  pose[armUp] = [0, bob + armLift];
  return pose;
}

/** Standing pose; `breath` dips the upper body one pixel. */
export function idlePose(breath: boolean): Pose {
  const b = breath ? 1 : 0;
  return { body: [0, b], armL: [0, b], armR: [0, b], footL: [0, 0], footR: [0, 0] };
}

/** Snap to whole screen pixels so the character and the world never shimmer against each other. */
export function snap(v: number): number {
  return Math.round(v * WORLD_ZOOM) / WORLD_ZOOM;
}

export class CharacterView {
  readonly root: Phaser.GameObjects.Container;
  private readonly flipper: Phaser.GameObjects.Container;
  private readonly pieces = {} as Record<PieceName, Phaser.GameObjects.Image>;
  private readonly shadow: Phaser.GameObjects.Ellipse;

  private phase = 0;
  private stillFor = 0;
  private idleClock = Math.random() * BREATH_EVERY_MS;
  private lastX: number;
  private lastY: number;
  private lastHalf = 0;
  /** True when moving mostly left/right (feet scissor); false when moving up/down (feet lift in place). */
  private sideways = true;

  /**
   * @param texture a 16x16 character image (see doll.ts), or a sheet key + frame.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    texture: { key: string; frame?: number | string },
    x: number,
    y: number,
    isMe: boolean,
    /** Called on each footfall (used for footstep sounds). */
    private readonly onStep?: () => void,
  ) {
    this.lastX = x;
    this.lastY = y;
    // A soft shadow; yours gets a light ring so you can find yourself.
    this.shadow = scene.add.ellipse(0, 3, 12, 5, isMe ? 0xfff3c4 : 0x000000, isMe ? 0.55 : 0.3);
    this.flipper = scene.add.container(0, 0);
    for (const name of DRAW_ORDER) {
      const [cx, cy, cw, ch] = PIECES[name];
      const img = scene.add.image(0, BODY_Y, texture.key, texture.frame).setCrop(cx, cy, cw, ch);
      this.pieces[name] = img;
      this.flipper.add(img);
    }
    this.root = scene.add.container(snap(x), snap(y), [this.shadow, this.flipper]);
    this.root.setDepth(y);
  }

  /** Swap the character image (e.g. a player changed their look). */
  setTexture(texture: { key: string; frame?: number | string }) {
    for (const name of DRAW_ORDER) {
      const [cx, cy, cw, ch] = PIECES[name];
      this.pieces[name].setTexture(texture.key, texture.frame).setCrop(cx, cy, cw, ch);
    }
  }

  /** Move to the latest position and animate according to how far we moved. */
  update(x: number, y: number, dtMs: number) {
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const dist = Math.hypot(dx, dy);
    this.lastX = x;
    this.lastY = y;

    if (Math.abs(dx) > 0.01) this.flipper.setScale(dx < 0 ? -1 : 1, 1);

    if (dist > 0.01) {
      this.stillFor = 0;
      this.sideways = Math.abs(dx) >= Math.abs(dy) * 0.5;
      this.phase = (this.phase + dist / STRIDE) % 1;
    } else {
      this.stillFor += dtMs;
    }

    if (this.stillFor < STOP_AFTER_MS) {
      const half = this.phase < 0.5 ? 0 : 1;
      // A foot just came down: kick up a little dust under it.
      if (half !== this.lastHalf) {
        this.dust(half === 0 ? 3 : -3);
        this.onStep?.();
        this.lastHalf = half;
      }
      this.applyPose(walkPose(this.phase, this.sideways));
      this.idleClock = 0;
    } else {
      this.phase = 0;
      this.lastHalf = 0;
      this.idleClock = (this.idleClock + dtMs) % BREATH_EVERY_MS;
      this.applyPose(idlePose(this.idleClock < BREATH_DIP_MS));
    }

    this.root.setPosition(snap(x), snap(y)).setDepth(y);
  }

  private applyPose(pose: Pose) {
    for (const name of DRAW_ORDER) {
      const [ox, oy] = pose[name];
      this.pieces[name].setPosition(ox, BODY_Y + oy);
    }
  }

  /** A small puff of dust at the foot that just landed (offset in art pixels from centre). */
  private dust(footOffsetX: number) {
    const facing = this.flipper.scaleX;
    const puff = this.scene.add
      .circle(this.root.x + footOffsetX * facing, this.root.y + 4, 1.5, DUST_COLOUR, 0.7)
      .setDepth(this.root.depth - 0.5);
    this.scene.tweens.add({
      targets: puff,
      y: puff.y - 2,
      scale: 2,
      alpha: 0,
      duration: 350,
      onComplete: () => puff.destroy(),
    });
  }

  destroy() {
    this.root.destroy();
  }
}
