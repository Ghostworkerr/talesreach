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
  // Feet include one extra row of leg (row 13) so a body bob never opens a gap.
  footL: [0, 13, 8, 3],
  footR: [8, 13, 8, 3],
} as const;
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

  constructor(
    private readonly scene: Phaser.Scene,
    frame: number,
    x: number,
    y: number,
    isMe: boolean,
  ) {
    this.lastX = x;
    this.lastY = y;
    // A soft shadow; yours gets a light ring so you can find yourself.
    this.shadow = scene.add.ellipse(0, 3, 12, 5, isMe ? 0xfff3c4 : 0x000000, isMe ? 0.55 : 0.3);
    this.flipper = scene.add.container(0, 0);
    for (const name of Object.keys(PIECES) as PieceName[]) {
      const [cx, cy, cw, ch] = PIECES[name];
      const img = scene.add.image(0, BODY_Y, SHEETS.chars.key, frame).setCrop(cx, cy, cw, ch);
      this.pieces[name] = img;
      this.flipper.add(img);
    }
    // Draw order: feet, then arms behind body edges, then body on top.
    this.flipper.bringToTop(this.pieces.body);
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
      this.phase = (this.phase + dist / STRIDE) % 1;
    } else {
      this.stillFor += dtMs;
    }

    const walking = this.stillFor < STOP_AFTER_MS;
    if (walking) this.poseWalk();
    else this.poseIdle(dtMs);

    this.root.setPosition(snap(x), snap(y)).setDepth(y);
  }

  /** Two steps per stride: a foot lifts, the opposite arm swings, the body bobs. */
  private poseWalk() {
    const half = this.phase < 0.5 ? 0 : 1;
    const local = (this.phase * 2) % 1;
    const lift = local < 0.6 ? 1 : 0;
    const bob = local > 0.15 && local < 0.6 ? -1 : 0;

    // A foot just came down: kick up a little dust under it.
    if (half !== this.lastHalf) {
      this.dust(half === 0 ? 3 : -3);
      this.lastHalf = half;
    }

    this.setPiece("footL", 0, half === 0 ? -lift : 0);
    this.setPiece("footR", 0, half === 1 ? -lift : 0);
    this.setPiece("body", 0, bob);
    // Arms swing opposite to the legs.
    this.setPiece("armL", 0, bob + (half === 1 ? -lift : 0));
    this.setPiece("armR", 0, bob + (half === 0 ? -lift : 0));
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
