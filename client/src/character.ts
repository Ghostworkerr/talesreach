import Phaser from "phaser";
import { SHEETS } from "./art";
import { WORLD_ZOOM } from "./display";

/**
 * A character drawn as paper-doll pieces cut from one 16x16 frame, so it can be
 * animated in code (the Kenney pack has no walk frames). Every offset is a whole
 * art pixel, so the pixel art stays crisp.
 *
 * Piece layout inside the 16x16 frame (x, y, width, height):
 */
const PIECES = {
  body: [3, 0, 10, 14],
  armL: [0, 6, 3, 8],
  armR: [13, 6, 3, 8],
  // Feet overlap the body's last row and are drawn in front, so steps are clearly visible.
  footL: [0, 13, 8, 3],
  footR: [8, 13, 8, 3],
} as const;
/** Draw order, back to front. */
const DRAW_ORDER: readonly PieceName[] = ["body", "armL", "armR", "footL", "footR"];
/** How far (art pixels) the swinging foot reaches forward/back when walking sideways. */
const REACH = 2;
type PieceName = keyof typeof PIECES;

/** Distance walked per full stride (two steps), in world pixels. */
const STRIDE = 32;
/** After this long without moving, the character settles into idle. */
const STOP_AFTER_MS = 90;
/** Idle breathing: one gentle dip every this many ms. */
const BREATH_EVERY_MS = 2400;
const BREATH_DIP_MS = 450;
/** Sprite centre sits 4px above the character's ground point. */
const BODY_Y = -4;

const DUST_COLOUR = 0xd9caa9;

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

  constructor(
    private readonly scene: Phaser.Scene,
    frame: number,
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
      const img = scene.add.image(0, BODY_Y, SHEETS.chars.key, frame).setCrop(cx, cy, cw, ch);
      this.pieces[name] = img;
      this.flipper.add(img);
    }
    this.root = scene.add.container(snap(x), snap(y), [this.shadow, this.flipper]);
    this.root.setDepth(y);
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

    const walking = this.stillFor < STOP_AFTER_MS;
    if (walking) this.poseWalk();
    else this.poseIdle(dtMs);

    this.root.setPosition(snap(x), snap(y)).setDepth(y);
  }

  /**
   * Two steps per stride. In each step one foot swings (lifts up to 2px and, when
   * walking sideways, moves from back to front) while the other stays planted and
   * slides back; the opposite arm swings up and the body rises at mid-step.
   */
  private poseWalk() {
    const half = this.phase < 0.5 ? 0 : 1;
    const t = (this.phase * 2) % 1;

    // A foot just came down: kick up a little dust under it.
    if (half !== this.lastHalf) {
      this.dust(half === 0 ? 3 : -3);
      this.onStep?.();
      this.lastHalf = half;
    }

    const reach = this.sideways ? REACH : 0;
    const swingX = Math.round(-reach + 2 * reach * t);
    const plantX = -Math.round(swingX / 2);
    const swingY = t < 0.15 || t > 0.85 ? 0 : t < 0.3 || t > 0.7 ? -1 : -2;
    const bob = t > 0.3 && t < 0.7 ? -1 : 0;
    const armLift = t > 0.15 && t < 0.85 ? -1 : 0;

    const [swing, plant] = half === 0 ? (["footL", "footR"] as const) : (["footR", "footL"] as const);
    const [armUp, armDown] = half === 0 ? (["armR", "armL"] as const) : (["armL", "armR"] as const);
    this.setPiece(swing, swingX, swingY);
    this.setPiece(plant, plantX, 0);
    this.setPiece("body", 0, bob);
    this.setPiece(armUp, 0, bob + armLift);
    this.setPiece(armDown, 0, bob);
    this.idleClock = 0;
  }

  /** Standing still: feet down, a slow breath now and then. */
  private poseIdle(dtMs: number) {
    this.phase = 0;
    this.lastHalf = 0;
    this.idleClock = (this.idleClock + dtMs) % BREATH_EVERY_MS;
    const breath = this.idleClock < BREATH_DIP_MS ? 1 : 0;
    this.setPiece("footL", 0, 0);
    this.setPiece("footR", 0, 0);
    this.setPiece("body", 0, breath);
    this.setPiece("armL", 0, breath);
    this.setPiece("armR", 0, breath);
  }

  private setPiece(name: PieceName, ox: number, oy: number) {
    this.pieces[name].setPosition(ox, BODY_Y + oy);
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
