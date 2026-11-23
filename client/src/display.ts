/**
 * Screen density. Phones have 2–3 real pixels per CSS pixel; drawing at that
 * density keeps pixel art sharp instead of letting the browser stretch it.
 * Rounded to a whole number so every art pixel maps to whole screen pixels,
 * and capped at 3 to keep phones fast.
 */
export const DPR = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));

/** World zoom in CSS pixels: each 16px tile shows as 32 CSS px. */
export const WORLD_ZOOM = 2 * DPR;

/** Game canvas size in real (device) pixels for the current window. */
export function canvasSize(): { width: number; height: number } {
  return { width: Math.round(window.innerWidth * DPR), height: Math.round(window.innerHeight * DPR) };
}
