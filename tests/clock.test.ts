import { describe, expect, it } from "vitest";
import { SEASON_MS, WORLD_DAY_MS, WORLD_EPOCH_MS, darknessAt, worldTime } from "@talesreach/shared";

const at = (day: number, hour: number) => WORLD_EPOCH_MS + (day - 1) * WORLD_DAY_MS + (hour / 24) * WORLD_DAY_MS;

describe("world clock", () => {
  it("a day lasts 2 real hours, and the clock starts at day 1, midnight, Spring", () => {
    expect(WORLD_DAY_MS).toBe(7_200_000);
    expect(worldTime(WORLD_EPOCH_MS)).toMatchObject({ day: 1, hour: 0, minute: 0, season: "Spring", seasonDay: 1, year: 1 });
    expect(worldTime(at(3, 13.5))).toMatchObject({ day: 3, hour: 13, minute: 30, part: "Midday" });
  });

  it("seasons change every real week; four seasons make a year", () => {
    expect(worldTime(WORLD_EPOCH_MS + SEASON_MS).season).toBe("Summer");
    expect(worldTime(WORLD_EPOCH_MS + 3 * SEASON_MS + 1).season).toBe("Winter");
    expect(worldTime(WORLD_EPOCH_MS + 4 * SEASON_MS).year).toBe(2);
    expect(worldTime(WORLD_EPOCH_MS + SEASON_MS - 1).seasonDay).toBe(84);
  });

  it("darkness: full at night, none by day, smooth at dawn and dusk", () => {
    expect(darknessAt(0)).toBe(1);
    expect(darknessAt(12 / 24)).toBe(0);
    const dusk = darknessAt(20 / 24);
    expect(dusk).toBeGreaterThan(0.3);
    expect(dusk).toBeLessThan(0.7);
    let prev = darknessAt(18 / 24);
    for (let h = 18; h <= 22; h += 0.25) {
      const d = darknessAt(h / 24);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it("is the same for everyone and survives restarts (depends only on the time)", () => {
    const now = Date.now();
    expect(worldTime(now)).toEqual(worldTime(now));
  });
});
