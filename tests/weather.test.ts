import { describe, expect, it } from "vitest";
import {
  SEASONS,
  WEATHER_EFFECTS,
  WEATHER_KINDS,
  WEATHER_MAX_MS,
  WEATHER_MIN_MS,
  rollWeather,
  weatherDuration,
  weatherEffectsAt,
} from "@talesreach/shared";
import { WeatherSystem } from "../server/src/world/weather.js";

const rolls = (n: number) => Array.from({ length: n }, (_, i) => i / n);

describe("weather rules", () => {
  it("every season can be clear, rainy, stormy or foggy, and snow only falls where it can snow", () => {
    for (const season of SEASONS) {
      const seen = new Set(rolls(400).map((r) => rollWeather(season, r)));
      for (const kind of ["clear", "rain", "storm", "fog"]) expect(seen.has(kind as never), `${season} ${kind}`).toBe(true);
      expect(seen.has("snow")).toBe(false);
    }
    expect(new Set(rolls(400).map((r) => rollWeather("Winter", r, true))).has("snow")).toBe(true);
    expect(new Set(rolls(400).map((r) => rollWeather("Summer", r, true))).has("snow")).toBe(false);
  });

  it("summer is mostly clear; autumn is foggier than summer", () => {
    const share = (season: (typeof SEASONS)[number], kind: string) => rolls(1000).filter((r) => rollWeather(season, r) === kind).length / 1000;
    expect(share("Summer", "clear")).toBeGreaterThan(0.5);
    expect(share("Autumn", "fog")).toBeGreaterThan(share("Summer", "fog"));
  });

  it("odd rolls never break it", () => {
    for (const r of [-1, 0, 0.999999, 1, 5, Number.NaN]) expect(WEATHER_KINDS).toContain(rollWeather("Spring", r));
  });

  it("each weather lasts 15–30 minutes", () => {
    expect(weatherDuration(0)).toBe(WEATHER_MIN_MS);
    expect(weatherDuration(1)).toBe(WEATHER_MAX_MS);
    expect(weatherDuration(9)).toBe(WEATHER_MAX_MS);
    expect(WEATHER_MIN_MS).toBe(15 * 60_000);
    expect(WEATHER_MAX_MS).toBe(30 * 60_000);
  });

  it("gameplay effects: fog shortens sight, rain wets and weakens fire, storms stop caravans; indoors is dry", () => {
    expect(WEATHER_EFFECTS.fog.sight).toBeLessThan(WEATHER_EFFECTS.rain.sight);
    expect(WEATHER_EFFECTS.clear.sight).toBe(1);
    expect(WEATHER_EFFECTS.rain.wet).toBe(true);
    expect(WEATHER_EFFECTS.rain.fire).toBeLessThan(1);
    expect(WEATHER_EFFECTS.storm.stopsCaravans).toBe(true);
    expect(WEATHER_EFFECTS.storm.lightning).toBe(true);
    expect(weatherEffectsAt("storm", true)).toEqual(WEATHER_EFFECTS.clear);
  });
});

describe("server weather", () => {
  it("keeps its weather until the time is up, then rolls again", () => {
    let i = 0;
    const seq = [0.0, 0.5, 0.99, 0.0];
    const w = new WeatherSystem(1_000_000, () => seq[i++ % seq.length]!);
    expect(w.kind).toBe("clear"); // first roll 0 → the first (clear) weather
    expect(w.until - w.since).toBe(weatherDuration(0.5));
    expect(w.update(w.until - 1)).toBe(false);
    expect(w.update(w.until)).toBe(true);
    expect(w.previous).toBe("clear");
    expect(w.kind).not.toBe("clear");
    expect(w.since).toBeGreaterThan(1_000_000);
  });

  it("can be set (for tests and admins) and remembers the weather before", () => {
    const w = new WeatherSystem(0, () => 0.3);
    const before = w.kind;
    w.set("storm", 5000);
    expect(w).toMatchObject({ kind: "storm", previous: before, since: 5000 });
    expect(w.effects.lightning).toBe(true);
  });
});
