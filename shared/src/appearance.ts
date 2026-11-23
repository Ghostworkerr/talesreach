import { z } from "zod";

/**
 * Character appearance: a handful of small numbers (choice indexes), validated
 * by the server. The client turns them into paper-doll layers from the Kenney
 * Roguelike Characters sheet (54 columns). Frame numbers are not secret.
 */
export const CHAR_COLS = 54;
const f = (col: number, row: number) => row * CHAR_COLS + col;

/** Skin tone (4) x build (2). */
export const BODY_FRAMES = [f(0, 0), f(1, 0), f(0, 1), f(1, 1), f(0, 2), f(1, 2), f(0, 3), f(1, 3)];
/** Trousers/boots: 10 colours x 2 cuts. */
export const LEG_FRAMES = Array.from({ length: 20 }, (_, i) => f(3 + (i % 2), Math.floor(i / 2)));
/** Shirts, tunics, vests and armour: columns 6..17, rows 0..9. */
export const OUTFIT_FRAMES = Array.from({ length: 120 }, (_, i) => f(6 + (i % 12), Math.floor(i / 12)));

/** Hair colours: where each colour's 4x4 block starts. */
export const HAIR_COLOUR_ORIGINS = [
  { name: "Brown", col: 19, row: 0 },
  { name: "Ginger", col: 23, row: 0 },
  { name: "Blonde", col: 19, row: 4 },
  { name: "Grey", col: 23, row: 4 },
  { name: "White", col: 19, row: 8 },
] as const;
/** Hair styles and beards as offsets inside a colour block (index 0 = none). */
export const HAIR_STYLE_OFFSETS: readonly (readonly [number, number] | null)[] = [
  null, [0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2],
];
export const BEARD_OFFSETS: readonly (readonly [number, number] | null)[] = [
  null, [2, 0], [3, 0], [0, 2], [3, 2], [0, 3], [1, 3], [2, 3], [3, 3],
];
/** Headwear (index 0 = none): caps/headbands, hoods, pointed hats. Helmets come with armour later. */
export const HAT_FRAMES: readonly (number | null)[] = [
  null,
  f(28, 2), f(30, 2), f(28, 3), f(30, 3), f(28, 4), f(30, 4), f(28, 5), f(30, 5),
  f(28, 7), f(29, 7), f(30, 7), f(31, 7),
  f(28, 8), f(29, 8), f(30, 8), f(31, 8),
];

export const Appearance = z
  .object({
    body: z.number().int().min(0).max(BODY_FRAMES.length - 1),
    legs: z.number().int().min(0).max(LEG_FRAMES.length - 1),
    outfit: z.number().int().min(0).max(OUTFIT_FRAMES.length - 1),
    hairStyle: z.number().int().min(0).max(HAIR_STYLE_OFFSETS.length - 1),
    hairColour: z.number().int().min(0).max(HAIR_COLOUR_ORIGINS.length - 1),
    beard: z.number().int().min(0).max(BEARD_OFFSETS.length - 1),
    hat: z.number().int().min(0).max(HAT_FRAMES.length - 1),
  })
  .strict();
export type Appearance = z.infer<typeof Appearance>;

export const DEFAULT_APPEARANCE: Appearance = { body: 0, legs: 2, outfit: 0, hairStyle: 1, hairColour: 0, beard: 0, hat: 0 };

/** The sheet frames to draw, bottom layer first. */
export function appearanceFrames(a: Appearance): number[] {
  const frames = [BODY_FRAMES[a.body]!, LEG_FRAMES[a.legs]!, OUTFIT_FRAMES[a.outfit]!];
  const origin = HAIR_COLOUR_ORIGINS[a.hairColour]!;
  const beard = BEARD_OFFSETS[a.beard];
  if (beard) frames.push(f(origin.col + beard[0], origin.row + beard[1]));
  const hair = HAIR_STYLE_OFFSETS[a.hairStyle];
  if (hair) frames.push(f(origin.col + hair[0], origin.row + hair[1]));
  const hat = HAT_FRAMES[a.hat];
  if (hat !== null && hat !== undefined) frames.push(hat);
  return frames;
}

/** A random appearance (used by the creator's Random button and for guests who skip). */
export function randomAppearance(rand: () => number = Math.random): Appearance {
  const pick = (n: number) => Math.floor(rand() * n);
  return {
    body: pick(BODY_FRAMES.length),
    legs: pick(LEG_FRAMES.length),
    outfit: pick(OUTFIT_FRAMES.length),
    hairStyle: pick(HAIR_STYLE_OFFSETS.length),
    hairColour: pick(HAIR_COLOUR_ORIGINS.length),
    beard: rand() < 0.35 ? 1 + pick(BEARD_OFFSETS.length - 1) : 0,
    hat: rand() < 0.3 ? 1 + pick(HAT_FRAMES.length - 1) : 0,
  };
}
