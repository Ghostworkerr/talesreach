/**
 * Weather (task 2.2). The server rolls the weather for each region every 15–30 real
 * minutes and shares it in the room state; clients only draw it. Seasons change the odds.
 * Gameplay effects live here so the server and later systems (crops, fire, caravans,
 * monsters) all read the same numbers.
 */
import type { Season } from "./clock.js";

export const WEATHER_KINDS = ["clear", "cloudy", "rain", "storm", "fog", "snow"] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/** Each roll lasts this long (real milliseconds): 15–30 minutes. */
export const WEATHER_MIN_MS = 15 * 60_000;
export const WEATHER_MAX_MS = 30 * 60_000;
/** How long the change from one weather to the next takes on screen. */
export const WEATHER_BLEND_MS = 20_000;

export interface WeatherEffects {
  /** How far you can see outdoors, as a share of normal (fog and storms shorten sight). */
  sight: number;
  /** Rain falls: crops get watered (task 2.11), fire is weaker (task 2.3), ground is wet. */
  wet: boolean;
  /** Fire damage multiplier (rain/storm/snow weaken fire). */
  fire: number;
  /** Caravans stay home (later tasks). */
  stopsCaravans: boolean;
  /** Extra darkness added to the day/night darkness (0..1). */
  gloom: number;
  /** Lightning strikes now and then. */
  lightning: boolean;
}

export const WEATHER_EFFECTS: Record<WeatherKind, WeatherEffects> = {
  clear: { sight: 1, wet: false, fire: 1, stopsCaravans: false, gloom: 0, lightning: false },
  cloudy: { sight: 1, wet: false, fire: 1, stopsCaravans: false, gloom: 0.12, lightning: false },
  rain: { sight: 0.9, wet: true, fire: 0.75, stopsCaravans: false, gloom: 0.22, lightning: false },
  storm: { sight: 0.75, wet: true, fire: 0.5, stopsCaravans: true, gloom: 0.38, lightning: true },
  fog: { sight: 0.6, wet: false, fire: 1, stopsCaravans: false, gloom: 0.15, lightning: false },
  snow: { sight: 0.8, wet: true, fire: 0.85, stopsCaravans: false, gloom: 0.1, lightning: false },
};

/** How likely each weather is, per season (snow only where `snowy`, e.g. mountains). */
export const WEATHER_ODDS: Record<Season, Partial<Record<WeatherKind, number>>> = {
  Spring: { clear: 35, cloudy: 25, rain: 28, storm: 5, fog: 7 },
  Summer: { clear: 60, cloudy: 18, rain: 10, storm: 8, fog: 4 },
  Autumn: { clear: 25, cloudy: 27, rain: 25, storm: 8, fog: 15 },
  Winter: { clear: 30, cloudy: 35, rain: 12, storm: 5, fog: 18, snow: 30 },
};

/** Pick a weather from a season's odds (`roll` is 0..1). Snow becomes cloudy where it can't snow. */
export function rollWeather(season: Season, roll: number, snowy = false): WeatherKind {
  const odds = Object.entries(WEATHER_ODDS[season]).filter(([k]) => snowy || k !== "snow") as [WeatherKind, number][];
  const total = odds.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.min(Math.max(roll, 0), 0.999999) * total;
  for (const [kind, weight] of odds) {
    if (r < weight) return kind;
    r -= weight;
  }
  return "clear";
}

/** How long a roll lasts (`roll` is 0..1). */
export function weatherDuration(roll: number): number {
  return Math.round(WEATHER_MIN_MS + Math.min(Math.max(roll, 0), 1) * (WEATHER_MAX_MS - WEATHER_MIN_MS));
}

/** Outdoors only: interiors keep the weather out (you still hear it). */
export function weatherEffectsAt(kind: WeatherKind, indoors: boolean): WeatherEffects {
  return indoors ? WEATHER_EFFECTS.clear : WEATHER_EFFECTS[kind];
}

/** Words for the HUD. */
export const WEATHER_LABELS: Record<WeatherKind, { icon: string; name: string }> = {
  clear: { icon: "☀️", name: "Clear" },
  cloudy: { icon: "☁️", name: "Cloudy" },
  rain: { icon: "🌧️", name: "Rain" },
  storm: { icon: "⛈️", name: "Storm" },
  fog: { icon: "🌫️", name: "Fog" },
  snow: { icon: "🌨️", name: "Snow" },
};
