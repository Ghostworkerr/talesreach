/**
 * The world clock (GAME_SPEC §3): owned by the server, the same for everyone.
 * A day lasts 2 real hours; a season lasts a real week; a year is 4 seasons.
 * Time counts from a fixed start date, so server restarts don't reset the day.
 */
export const WORLD_DAY_MS = 2 * 60 * 60 * 1000;
export const SEASON_MS = 7 * 24 * 60 * 60 * 1000;
export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
export type Season = (typeof SEASONS)[number];
/** The world began at midnight UTC on 1 January 2026 (day 1, Spring). */
export const WORLD_EPOCH_MS = Date.UTC(2026, 0, 1);

export type DayPart = "Night" | "Dawn" | "Morning" | "Midday" | "Afternoon" | "Dusk" | "Evening";

export interface WorldTime {
  /** 1-based day count since the world began. */
  day: number;
  /** 0..1 through the day (0 = midnight, 0.5 = noon). */
  phase: number;
  /** In-world clock, 0..23 and 0..59. */
  hour: number;
  minute: number;
  part: DayPart;
  season: Season;
  /** 1-based day within the current season (a season is 84 world days). */
  seasonDay: number;
  year: number;
  /** How dark it is outdoors: 0 = bright day, 1 = deepest night. */
  darkness: number;
}

export function worldTime(nowMs: number): WorldTime {
  const t = Math.max(0, nowMs - WORLD_EPOCH_MS);
  const phase = (t % WORLD_DAY_MS) / WORLD_DAY_MS;
  const minutes = Math.floor(phase * 24 * 60);
  const hour = Math.floor(minutes / 60);
  const seasonIndex = Math.floor(t / SEASON_MS) % SEASONS.length;
  return {
    day: Math.floor(t / WORLD_DAY_MS) + 1,
    phase,
    hour,
    minute: minutes % 60,
    part: dayPart(hour),
    season: SEASONS[seasonIndex]!,
    seasonDay: Math.floor((t % SEASON_MS) / WORLD_DAY_MS) + 1,
    year: Math.floor(t / (SEASON_MS * SEASONS.length)) + 1,
    darkness: darknessAt(phase),
  };
}

function dayPart(hour: number): DayPart {
  if (hour < 5) return "Night";
  if (hour < 7) return "Dawn";
  if (hour < 11) return "Morning";
  if (hour < 14) return "Midday";
  if (hour < 18) return "Afternoon";
  if (hour < 20) return "Dusk";
  if (hour < 22) return "Evening";
  return "Night";
}

/**
 * Smooth darkness curve: full night 22:00–04:30, dawn 04:30–07:00,
 * full day 07:00–18:00, dusk 18:00–22:00.
 */
export function darknessAt(phase: number): number {
  const h = phase * 24;
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (h < 4.5 || h >= 22) return 1;
  if (h < 7) return 1 - ease((h - 4.5) / 2.5);
  if (h < 18) return 0;
  return ease((h - 18) / 4);
}

export const isNight = (nowMs: number) => worldTime(nowMs).darkness > 0.5;
