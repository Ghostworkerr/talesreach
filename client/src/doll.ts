import type Phaser from "phaser";
import { CHAR_COLS, appearanceFrames, type Appearance } from "@talesreach/shared";
import { SHEETS, TILE } from "./art";

/** Draw an appearance's layers (body, legs, outfit, beard, hair, hat) onto a 16x16 canvas. */
export function drawDoll(ctx: CanvasRenderingContext2D, sheet: CanvasImageSource, a: Appearance, dx = 0, dy = 0) {
  ctx.imageSmoothingEnabled = false;
  for (const frame of appearanceFrames(a)) {
    const col = frame % CHAR_COLS;
    const row = Math.floor(frame / CHAR_COLS);
    ctx.drawImage(sheet, col * (TILE + 1), row * (TILE + 1), TILE, TILE, dx, dy, TILE, TILE);
  }
}

/** Stable texture key for an appearance (same look -> same texture, made once). */
export const dollKey = (a: Appearance) =>
  `doll:${a.body}.${a.legs}.${a.outfit}.${a.hairStyle}.${a.hairColour}.${a.beard}.${a.hat}`;

/**
 * A 16x16 texture of the combined character, so the world can animate it with
 * the same paper-doll pieces as before. Cached per look.
 */
export function dollTexture(scene: Phaser.Scene, a: Appearance): { key: string } {
  const key = dollKey(a);
  if (!scene.textures.exists(key)) {
    const canvas = scene.textures.createCanvas(key, TILE, TILE);
    const sheet = scene.textures.get(SHEETS.chars.key).getSourceImage() as CanvasImageSource;
    if (canvas) {
      drawDoll(canvas.getContext(), sheet, a);
      canvas.refresh();
    }
  }
  return { key };
}
