import Phaser from "phaser";
import { WEATHER_BLEND_MS, WEATHER_EFFECTS, type WeatherKind } from "@talesreach/shared";
import { audio, type AmbienceLayer } from "./audio";

/** What the server says about the sky. */
export interface SkyState {
  weather: string;
  weatherPrev: string;
  weatherSince: number;
}

interface Drop {
  x: number;
  y: number;
  speed: number;
  len: number;
  sway: number;
}
interface Splash {
  x: number;
  y: number;
  age: number;
}

const KINDS = Object.keys(WEATHER_EFFECTS) as WeatherKind[];
const asKind = (s: string): WeatherKind => (KINDS.includes(s as WeatherKind) ? (s as WeatherKind) : "clear");

/** How much of each kind of thing falls, per weather (at full strength). */
const RAIN: Partial<Record<WeatherKind, number>> = { rain: 110, storm: 200 };
const SNOW: Partial<Record<WeatherKind, number>> = { snow: 120 };
const FOG: Partial<Record<WeatherKind, number>> = { fog: 1, storm: 0.25, rain: 0.12 };
const MAX_DROPS = 220;
const FOG_KEY = "weather:fog";
const VIGNETTE_KEY = "weather:vignette";

/** A cheap, repeatable random number from an integer (same flashes for everyone). */
function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Draws the weather the server chose (task 2.2): rain with splashes, snow, drifting fog
 * that closes in on you, storm gloom with lightning and thunder. Changes blend over ~20 s.
 * Indoors you only hear it (muffled).
 */
export class WeatherView {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly fog: Phaser.GameObjects.TileSprite;
  private readonly fog2: Phaser.GameObjects.TileSprite;
  private readonly vignette: Phaser.GameObjects.Image;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private readonly drops: Drop[] = [];
  private readonly flakes: Drop[] = [];
  private splashes: Splash[] = [];
  private time = 0;
  private lastBolt = -1;
  /** Current blended amounts (0..1+), read by the scene for lighting and audio. */
  gloom = 0;
  rain = 0;
  wind = 0;
  wet = false;
  kind: WeatherKind = "clear";

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
    flashDepth: number,
  ) {
    makeTextures(scene);
    this.gfx = scene.add.graphics().setDepth(depth);
    this.fog = scene.add.tileSprite(0, 0, 64, 64, FOG_KEY).setOrigin(0, 0).setDepth(depth - 1).setAlpha(0);
    this.fog2 = scene.add.tileSprite(0, 0, 64, 64, FOG_KEY).setOrigin(0, 0).setDepth(depth - 1).setAlpha(0).setFlipX(true);
    this.vignette = scene.add.image(0, 0, VIGNETTE_KEY).setDepth(depth + 1).setAlpha(0);
    this.flash = scene.add.rectangle(0, 0, 10, 10, 0xeef4ff, 1).setOrigin(0, 0).setDepth(flashDepth).setAlpha(0);
    for (let i = 0; i < MAX_DROPS; i++) {
      this.drops.push({ x: Math.random(), y: Math.random(), speed: 0.8 + Math.random() * 0.4, len: 5 + Math.random() * 4, sway: Math.random() });
      this.flakes.push({ x: Math.random(), y: Math.random(), speed: 0.25 + Math.random() * 0.25, len: Math.random() < 0.3 ? 1.5 : 1, sway: Math.random() * Math.PI * 2 });
    }
  }

  /**
   * @param sky weather from the room state
   * @param serverNow server clock (ms), so blends and lightning match for everyone
   * @param indoors weather stays outside
   */
  update(dtMs: number, sky: SkyState, serverNow: number, indoors: boolean) {
    const dt = Math.min(dtMs, 100) / 1000;
    this.time += dt;
    const now = asKind(sky.weather);
    const before = asKind(sky.weatherPrev);
    this.kind = now;
    const t = Math.min(1, Math.max(0, (serverNow - sky.weatherSince) / WEATHER_BLEND_MS));
    const mix = (table: Partial<Record<WeatherKind, number>>) => (table[now] ?? 0) * t + (table[before] ?? 0) * (1 - t);
    const rainCount = mix(RAIN);
    const snowCount = mix(SNOW);
    const fog = mix(FOG);
    this.gloom = WEATHER_EFFECTS[now].gloom * t + WEATHER_EFFECTS[before].gloom * (1 - t);
    this.rain = rainCount / 200;
    this.wind = mix({ storm: 1, fog: 0.35, snow: 0.5, cloudy: 0.15 });
    this.wet = (WEATHER_EFFECTS[now].wet && t > 0.3) || (WEATHER_EFFECTS[before].wet && t < 0.7);

    const view = this.scene.cameras.main.worldView;
    this.gfx.clear();
    const show = !indoors;
    this.fog.setVisible(show && fog > 0.01);
    this.fog2.setVisible(show && fog > 0.01);
    this.vignette.setVisible(show && fog > 0.01);
    if (show) {
      this.drawRain(view, Math.round(rainCount), dt, now === "storm" ? 1.6 : 1);
      this.drawSnow(view, Math.round(snowCount), dt);
      this.drawFog(view, fog, dt);
    } else this.splashes = [];
    this.lightning(sky, serverNow, now === "storm" && t > 0.5, indoors, view);
  }

  /** Ambience levels for the weather (rain and wind), muffled indoors. */
  ambience(indoors: boolean): Partial<Record<AmbienceLayer, number>> {
    const k = indoors ? 0.3 : 1;
    return { rain: Math.min(1, this.rain * 1.4) * k, wind: this.wind * 0.8 * k };
  }

  private drawRain(view: Phaser.Geom.Rectangle, count: number, dt: number, slant: number) {
    if (count <= 0) return;
    const fall = view.height * 1.6;
    this.gfx.lineStyle(1, 0xd8e8f7, 0.7);
    for (let i = 0; i < count && i < this.drops.length; i++) {
      const d = this.drops[i]!;
      d.y += (fall * d.speed * dt) / view.height;
      d.x += (fall * 0.18 * slant * d.speed * dt) / view.width;
      if (d.y > 1) {
        // Hit the ground: sometimes leave a splash ring where it landed.
        if (Math.random() < 0.35) this.splashes.push({ x: view.x + d.x * view.width, y: view.y + Math.random() * view.height, age: 0 });
        d.y -= 1;
        d.x = Math.random();
      }
      if (d.x > 1) d.x -= 1;
      const x = view.x + d.x * view.width;
      const y = view.y + d.y * view.height;
      this.gfx.lineBetween(x, y, x - d.len * 0.18 * slant, y - d.len);
    }
    this.splashes = this.splashes.filter((s) => (s.age += dt) < 0.3);
    if (this.splashes.length > 80) this.splashes.splice(0, this.splashes.length - 80);
    for (const s of this.splashes) {
      const k = s.age / 0.3;
      this.gfx.lineStyle(0.75, 0xdcecf8, 0.6 * (1 - k));
      this.gfx.strokeEllipse(s.x, s.y, 2 + k * 5, 1 + k * 2);
    }
  }

  private drawSnow(view: Phaser.Geom.Rectangle, count: number, dt: number) {
    if (count <= 0) return;
    this.gfx.fillStyle(0xffffff, 0.85);
    for (let i = 0; i < count && i < this.flakes.length; i++) {
      const f = this.flakes[i]!;
      f.y += f.speed * dt * 0.5;
      f.sway += dt * 1.5;
      if (f.y > 1) {
        f.y -= 1;
        f.x = Math.random();
      }
      const x = view.x + ((f.x + Math.sin(f.sway) * 0.01 + 1) % 1) * view.width;
      this.gfx.fillCircle(x, view.y + f.y * view.height, f.len);
    }
  }

  private drawFog(view: Phaser.Geom.Rectangle, amount: number, dt: number) {
    if (amount <= 0.01) return;
    for (const [layer, speed, depthScale, alpha] of [
      [this.fog, 6, 0.6, 0.45],
      [this.fog2, -4, 0.85, 0.3],
    ] as const) {
      layer.setPosition(view.x, view.y).setSize(view.width, view.height);
      layer.tilePositionX = view.x * depthScale + this.time * speed;
      layer.tilePositionY = view.y * depthScale + this.time * speed * 0.3;
      layer.setAlpha(alpha * amount);
    }
    // The world fades into grey around you: you see less far.
    this.vignette.setPosition(view.centerX, view.centerY).setDisplaySize(view.width * 1.15, view.height * 1.15).setAlpha(0.85 * amount);
    void dt;
  }

  /** Lightning: the same flashes for everyone (from the server clock), thunder a moment later. */
  private lightning(sky: SkyState, serverNow: number, on: boolean, indoors: boolean, view: Phaser.Geom.Rectangle) {
    this.flash.setPosition(view.x, view.y).setSize(view.width, view.height);
    if (!on) return;
    const slot = Math.floor(serverNow / 3000);
    if (slot === this.lastBolt) return;
    this.lastBolt = slot;
    if (hash(slot + Math.floor(sky.weatherSince / 1000)) > 0.16) return; // about one bolt every 20 s
    const near = hash(slot * 7 + 3) < 0.4;
    if (!indoors) {
      this.scene.tweens.chain({
        targets: this.flash,
        tweens: [
          { alpha: near ? 0.75 : 0.35, duration: 50 },
          { alpha: 0.05, duration: 90 },
          { alpha: near ? 0.5 : 0.2, duration: 40 },
          { alpha: 0, duration: 380, ease: "Quad.easeOut" },
        ],
      });
    }
    // Sound travels slower than light: closer strikes rumble sooner and louder.
    const delay = near ? 250 + hash(slot) * 500 : 1200 + hash(slot) * 1800;
    this.scene.time.delayedCall(delay, () =>
      audio.play(near ? "thunder" : "thunderFar", { volume: (near ? 0.9 : 0.55) * (indoors ? 0.5 : 1), detune: (hash(slot * 3) - 0.5) * 400 }),
    );
  }

  destroy() {
    for (const o of [this.gfx, this.fog, this.fog2, this.vignette, this.flash]) o.destroy();
  }
}

/** Soft cloudy fog texture (tiles seamlessly) and a grey vignette, drawn once in code. */
function makeTextures(scene: Phaser.Scene) {
  if (!scene.textures.exists(FOG_KEY)) {
    const size = 256;
    const tex = scene.textures.createCanvas(FOG_KEY, size, size)!;
    const ctx = tex.getContext();
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 30 + rnd() * 60;
      // Draw each puff 9 times around the edges so the texture tiles without seams.
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, "rgba(225,230,235,0.35)");
          g.addColorStop(1, "rgba(225,230,235,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
    tex.refresh();
  }
  if (!scene.textures.exists(VIGNETTE_KEY)) {
    const size = 256;
    const tex = scene.textures.createCanvas(VIGNETTE_KEY, size, size)!;
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.55);
    g.addColorStop(0, "rgba(205,212,218,0)");
    g.addColorStop(1, "rgba(205,212,218,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }
}
