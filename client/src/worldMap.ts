import Phaser from "phaser";
import { CHUNK_TILES, parseTiledMap, type GameMap } from "@talesreach/shared";
import { SHEETS } from "./art";
import type { LightSource } from "./lighting";

/** Draw order of the map layers (characters go between Furniture and Above). */
export interface LayerDepths {
  ground: number;
  walls: number;
  decor: number;
  furniture: number;
  above: number;
}

/** Map tiles that give light at night (Kenney RPG sheet ids + 1 = gid): radius, strength, flicker. */
const LIGHT_TILES: Record<number, { radius: number; strength: number; flicker: number }> = {
  417: { radius: 56, strength: 1, flicker: 0.07 }, // wall torch
  419: { radius: 26, strength: 0.85, flicker: 0.12 }, // candle
  14: { radius: 78, strength: 1, flicker: 0.09 }, // hearth fire
  476: { radius: 44, strength: 0.9, flicker: 0.05 }, // candelabra
};

interface Chunk {
  x: number;
  y: number;
  w: number;
  h: number;
  layers: Partial<Record<string, number[][]>>;
}

const LAYER_NAMES = ["Ground", "Walls", "Decor", "Furniture", "Above"] as const;
/** Keep chunks this many tiles beyond the screen (so walking never shows a gap). */
const PRELOAD_TILES = 12;
/** Drop chunks this far (in chunks) outside the needed area (saves memory on phones). */
const UNLOAD_MARGIN = 1;

/**
 * A map streamed in chunks (task 2.1): the small meta file (collision, places, zones)
 * comes first; the drawn tiles arrive 32 x 32 tiles at a time around the camera.
 */
export class StreamedMap {
  readonly map: GameMap;
  /** Light sources of the loaded chunks (the Lighting effect reads this list every frame). */
  readonly lights: LightSource[] = [];
  private readonly tilemap: Phaser.Tilemaps.Tilemap;
  private readonly layers = new Map<string, Phaser.Tilemaps.TilemapLayer>();
  private readonly loaded = new Set<string>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly cols: number;
  private readonly rows: number;
  private destroyed = false;

  private constructor(
    private readonly scene: Phaser.Scene,
    readonly name: string,
    meta: unknown,
    depths: LayerDepths,
  ) {
    this.map = parseTiledMap(meta);
    const { width, height, tile } = this.map.grid;
    this.cols = Math.ceil(width / CHUNK_TILES);
    this.rows = Math.ceil(height / CHUNK_TILES);
    this.tilemap = scene.make.tilemap({ width, height, tileWidth: tile, tileHeight: tile });
    const rpg = this.tilemap.addTilesetImage("rpg", SHEETS.rpg.key, 16, 16, 0, 1, 1);
    const indoor = this.tilemap.addTilesetImage("indoor", SHEETS.indoor.key, 16, 16, 0, 1, 1 + 57 * 31);
    const sets = [rpg, indoor].filter((t): t is Phaser.Tilemaps.Tileset => t !== null);
    const depthOf: Record<string, number> = {
      Ground: depths.ground,
      Walls: depths.walls,
      Decor: depths.decor,
      Furniture: depths.furniture,
      Above: depths.above,
    };
    for (const n of LAYER_NAMES) {
      const layer = this.tilemap.createBlankLayer(n, sets, 0, 0, width, height);
      if (layer) this.layers.set(n, layer.setDepth(depthOf[n] ?? 0));
    }
  }

  /** Load a map's meta file and the chunks around a starting point. */
  static async load(scene: Phaser.Scene, name: string, depths: LayerDepths, around?: { x: number; y: number }): Promise<StreamedMap> {
    const res = await fetch(`/maps/${name}/meta.json`);
    if (!res.ok) throw new Error(`map ${name} missing`);
    const m = new StreamedMap(scene, name, await res.json(), depths);
    const p = around ?? { x: m.map.pixelWidth / 2, y: m.map.pixelHeight / 2 };
    const half = { w: scene.scale.width / scene.cameras.main.zoom / 2, h: scene.scale.height / scene.cameras.main.zoom / 2 };
    await m.stream(new Phaser.Geom.Rectangle(p.x - half.w, p.y - half.h, half.w * 2, half.h * 2));
    return m;
  }

  /** Load chunks the camera needs (plus a margin); unload ones far away. */
  stream(view: Phaser.Geom.Rectangle): Promise<void> {
    const t = this.map.grid.tile;
    const pad = PRELOAD_TILES * t;
    const span = CHUNK_TILES * t;
    const cx0 = Math.max(0, Math.floor((view.x - pad) / span));
    const cy0 = Math.max(0, Math.floor((view.y - pad) / span));
    const cx1 = Math.min(this.cols - 1, Math.floor((view.right + pad) / span));
    const cy1 = Math.min(this.rows - 1, Math.floor((view.bottom + pad) / span));
    const waits: Promise<void>[] = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) waits.push(this.ensure(cx, cy));
    for (const key of [...this.loaded]) {
      const [cx = 0, cy = 0] = key.split("_").map(Number);
      if (cx < cx0 - UNLOAD_MARGIN || cx > cx1 + UNLOAD_MARGIN || cy < cy0 - UNLOAD_MARGIN || cy > cy1 + UNLOAD_MARGIN) this.unload(key);
    }
    return Promise.all(waits).then(() => undefined);
  }

  get loadedChunks(): number {
    return this.loaded.size;
  }

  private ensure(cx: number, cy: number): Promise<void> {
    const key = `${cx}_${cy}`;
    if (this.loaded.has(key)) return Promise.resolve();
    const busy = this.loading.get(key);
    if (busy) return busy;
    const job = fetch(`/maps/${this.name}/${key}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Chunk>) : null))
      .then((chunk) => {
        if (chunk && !this.destroyed) this.place(key, chunk);
      })
      .catch(() => undefined) // offline: try again next time the camera moves
      .finally(() => this.loading.delete(key));
    this.loading.set(key, job);
    return job;
  }

  private place(key: string, chunk: Chunk) {
    for (const [name, rows] of Object.entries(chunk.layers)) {
      const layer = this.layers.get(name);
      if (!layer || !rows) continue;
      layer.putTilesAt(rows.map((r) => r.map((g) => (g ? g : -1))), chunk.x, chunk.y, false);
      if (name === "Ground" || name === "Above") continue;
      rows.forEach((r, y) =>
        r.forEach((g, x) => {
          const l = LIGHT_TILES[g];
          if (l) this.lights.push({ x: (chunk.x + x) * 16 + 8, y: (chunk.y + y) * 16 + 8, ...l, seed: this.lights.length * 1.7, chunk: key });
        }),
      );
    }
    this.loaded.add(key);
  }

  private unload(key: string) {
    const [cx = 0, cy = 0] = key.split("_").map(Number);
    const x = cx * CHUNK_TILES;
    const y = cy * CHUNK_TILES;
    for (const layer of this.layers.values()) layer.fill(-1, x, y, CHUNK_TILES, CHUNK_TILES, false);
    for (let i = this.lights.length - 1; i >= 0; i--) if (this.lights[i]!.chunk === key) this.lights.splice(i, 1);
    this.loaded.delete(key);
  }

  destroy() {
    this.destroyed = true;
    this.tilemap.destroy();
  }
}
