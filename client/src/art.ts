import type Phaser from "phaser";

/**
 * Art keys and frames from the Kenney Roguelike family (see docs/STYLE.md).
 * All sheets: 16x16 tiles with a 1px gap.
 */
export const TILE = 16;

/** Sheet keys match the tileset names inside the Tiled maps ("rpg", "indoor"). */
export const SHEETS = {
  rpg: { key: "rpg", url: "art/kenney-roguelike-rpg/roguelikeSheet_transparent.png" },
  indoor: { key: "indoor", url: "art/kenney-roguelike-indoors/roguelikeIndoor_transparent.png" },
  chars: { key: "chars", url: "art/kenney-roguelike-characters/roguelikeChar_transparent.png" },
} as const;

/** Maps are streamed in chunks by worldMap.ts (files built by tools/maps/build-chunks.mjs). */

export const RPG = {
  grass: 5,
  grassAlt: 62,
  /** Small free-standing decorations: blue flower, sprout, grass tufts. */
  decor: [541, 592, 598, 655],
  bush: 526,
  treeTop: 583,
  treeTrunk: 640,
  pineTop: 588,
  pineTrunk: 645,
} as const;

/** Ready-made characters, picked by the server-assigned colour number. */
export const READY_MADE_CHARACTERS = [270, 271, 324, 325, 378, 379, 432, 433] as const;

export function loadArt(scene: Phaser.Scene) {
  for (const s of Object.values(SHEETS)) {
    scene.load.spritesheet(s.key, s.url, { frameWidth: TILE, frameHeight: TILE, spacing: 1 });
  }
}
