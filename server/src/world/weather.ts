import {
  WEATHER_EFFECTS,
  rollWeather,
  weatherDuration,
  worldTime,
  type WeatherKind,
} from "@talesreach/shared";

/**
 * The region's weather (server-only): rolled every 15–30 minutes with the season's odds.
 * The room copies it into the shared state; clients only draw it.
 */
export class WeatherSystem {
  kind: WeatherKind;
  previous: WeatherKind = "clear";
  since: number;
  until: number;

  constructor(
    now = Date.now(),
    private readonly random: () => number = Math.random,
    private readonly snowy = false,
  ) {
    this.kind = rollWeather(worldTime(now).season, this.random(), this.snowy);
    this.since = now;
    this.until = now + weatherDuration(this.random());
  }

  /** Roll new weather when the current one has run its course. Returns true if it changed. */
  update(now = Date.now()): boolean {
    if (now < this.until) return false;
    this.set(rollWeather(worldTime(now).season, this.random(), this.snowy), now);
    return true;
  }

  /** Force a weather (tests and, later, admin tools). */
  set(kind: WeatherKind, now = Date.now()) {
    this.previous = this.kind;
    this.kind = kind;
    this.since = now;
    this.until = now + weatherDuration(this.random());
  }

  get effects() {
    return WEATHER_EFFECTS[this.kind];
  }
}
