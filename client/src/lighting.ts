import Phaser from "phaser";

/**
 * Day/night lighting (GAME_SPEC §3 "Drawing"): a tinted darkness layer over the
 * world with soft pools of light cut out of it — torches, candles and the hearth
 * flicker; your own character carries a small glow at night. Drawn at world
 * resolution into a render texture that follows the camera.
 */
export interface LightSource {
  x: number;
  y: number;
  /** Radius in world pixels. */
  radius: number;
  /** 0..1 strength. */
  strength: number;
  /** Flicker amount (0 = steady). */
  flicker: number;
  seed: number;
}

const GRADIENT_KEY = "light:gradient";
const GRADIENT_SIZE = 128;

/** Colour of the night, from dusk purple to deep blue. */
function nightColour(darkness: number): number {
  const dusk = Phaser.Display.Color.ValueToColor(0x3b2450);
  const night = Phaser.Display.Color.ValueToColor(0x070d26);
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(dusk, night, 100, Math.round(darkness * 100));
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

export class Lighting {
  private readonly rt: Phaser.GameObjects.RenderTexture;
  private readonly stamp: Phaser.GameObjects.Image;
  private time = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lights: LightSource[],
    depth: number,
  ) {
    if (!scene.textures.exists(GRADIENT_KEY)) {
      const canvas = scene.textures.createCanvas(GRADIENT_KEY, GRADIENT_SIZE, GRADIENT_SIZE)!;
      const ctx = canvas.getContext();
      const g = ctx.createRadialGradient(GRADIENT_SIZE / 2, GRADIENT_SIZE / 2, 0, GRADIENT_SIZE / 2, GRADIENT_SIZE / 2, GRADIENT_SIZE / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.45, "rgba(255,255,255,0.75)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE);
      canvas.refresh();
    }
    // Used only as a brush for erasing light out of the darkness; never shown itself.
    this.stamp = new Phaser.GameObjects.Image(scene, 0, 0, GRADIENT_KEY);
    const cam = scene.cameras.main;
    this.rt = scene.add.renderTexture(0, 0, Math.ceil(cam.worldView.width) + 4, Math.ceil(cam.worldView.height) + 4).setOrigin(0, 0).setDepth(depth);
  }

  /**
   * @param darkness 0 (day) .. 1 (deep night)
   * @param player your position, for your own small glow
   * @param indoors inside buildings the dark is softer (lamps everywhere)
   */
  update(dtMs: number, darkness: number, player: { x: number; y: number } | null, indoors: boolean) {
    this.time += dtMs / 1000;
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const w = Math.ceil(view.width) + 4;
    const h = Math.ceil(view.height) + 4;
    if (this.rt.width !== w || this.rt.height !== h) this.rt.resize(w, h, false);
    const ox = Math.floor(view.x) - 2;
    const oy = Math.floor(view.y) - 2;
    this.rt.setPosition(ox, oy);
    const alpha = darkness * (indoors ? 0.5 : 0.72);
    this.rt.setVisible(alpha > 0.01);
    if (alpha <= 0.01) return;

    this.rt.clear();
    this.rt.fill(nightColour(darkness), alpha);
    const draw = (x: number, y: number, radius: number, strength: number) => {
      if (x + radius < ox || y + radius < oy || x - radius > ox + w || y - radius > oy + h) return;
      this.stamp.setScale((radius * 2) / GRADIENT_SIZE);
      this.stamp.setAlpha(Math.min(1, strength));
      this.rt.erase(this.stamp, x - ox, y - oy);
    };
    for (const l of this.lights) {
      const f = l.flicker ? 1 + l.flicker * (Math.sin(this.time * 9 + l.seed) * 0.6 + Math.sin(this.time * 23 + l.seed * 3) * 0.4) : 1;
      draw(l.x, l.y, l.radius * f, l.strength);
    }
    if (player) draw(player.x, player.y - 4, 34, 0.55 * darkness);
    this.rt.render();
  }

  destroy() {
    this.rt.destroy();
    this.stamp.destroy();
  }
}
