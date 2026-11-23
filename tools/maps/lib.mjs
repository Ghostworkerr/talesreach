// Shared helpers for the Talesreach map generators (Tiled JSON output).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const RPG_COLS = 57;
export const RPG_FIRST = 1;
export const INDOOR_FIRST = 1 + RPG_COLS * 31; // 1768
export const rpg = (id) => RPG_FIRST + id;
export const indoor = (id) => INDOOR_FIRST + id;

/** Edge sets ("blob" autotiles) from the Kenney RPG sheet: corners, edges, middle and inner corners. */
export const WATER = { TL: 2, T: 3, TR: 4, L: 59, C: 60, R: 61, BL: 116, B: 117, BR: 118, iTL: 115, iTR: 114, iBL: 58, iBR: 57 };
export const DIRT = { TL: 520, T: 521, TR: 522, L: 577, C: 578, R: 579, BL: 634, B: 635, BR: 636, iTL: 576, iTR: 575, iBL: 519, iBR: 518 };

/** Deterministic random numbers so every build of a map is identical. */
export function makeRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Smooth value noise in 0..1 (for forests, marsh and meadows). */
export function makeNoise(seed, scale) {
  const rand = makeRandom(seed);
  const size = 64;
  const grid = Array.from({ length: size * size }, () => rand());
  const at = (x, y) => grid[((y % size) + size) % size * size + (((x % size) + size) % size)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / scale;
    const fy = y / scale;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

/** A blank map of the given size with the standard layers. */
export function createMap(W, H) {
  const blank = () => new Array(W * H).fill(0);
  const L = { ground: blank(), terrain: blank(), walls: blank(), decor: blank(), furniture: blank(), above: blank(), collision: blank() };
  const objects = [];
  let nextId = 1;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const api = {
    W,
    H,
    L,
    objects,
    inside,
    put(layer, x, y, gid, solid = false) {
      if (!inside(x, y)) return;
      L[layer][y * W + x] = gid;
      if (solid) L.collision[y * W + x] = rpg(756);
    },
    get(layer, x, y) {
      return inside(x, y) ? L[layer][y * W + x] : 0;
    },
    solid(x, y) {
      if (inside(x, y)) L.collision[y * W + x] = rpg(756);
    },
    clear(x, y) {
      if (inside(x, y)) L.collision[y * W + x] = 0;
    },
    isSolid(x, y) {
      return !inside(x, y) || L.collision[y * W + x] !== 0;
    },
    point(name, type, tx, ty) {
      objects.push({ id: nextId++, name, type, point: true, x: tx * 16 + 8, y: ty * 16 + 8, rotation: 0, visible: true, width: 0, height: 0 });
    },
    zone(name, type, tx, ty, tw, th, props) {
      objects.push({
        id: nextId++, name, type, x: tx * 16, y: ty * 16, width: tw * 16, height: th * 16, rotation: 0, visible: true,
        properties: Object.entries(props).map(([k, v]) => ({ name: k, type: typeof v === "number" ? "int" : "string", value: v })),
      });
    },
    get nextId() {
      return nextId;
    },
  };
  return api;
}

/**
 * Draw a terrain shape (water, dirt...) with proper edges. `mask(x, y)` says where
 * the terrain is. Thin bits (1 tile wide) are removed first so every edge has a tile.
 */
export function paintTerrain(map, mask, set, layer = "terrain") {
  const { W, H } = map;
  const on = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) on[y * W + x] = mask(x, y) ? 1 : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 1 : on[y * W + x]);
  // Remove 1-wide strips and lonely tiles until the shape is clean.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!on[y * W + x]) continue;
        const n = at(x, y - 1), s = at(x, y + 1), e = at(x + 1, y), w = at(x - 1, y);
        // Diagonal-only links would need tiles the sheet doesn't have: cut them too.
        const badDiag = (!n && !w && at(x - 1, y - 1)) || (!n && !e && at(x + 1, y - 1)) || (!s && !w && at(x - 1, y + 1)) || (!s && !e && at(x + 1, y + 1));
        if ((!n && !s) || (!e && !w) || badDiag) {
          on[y * W + x] = 0;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!on[y * W + x]) continue;
      const n = at(x, y - 1), s = at(x, y + 1), e = at(x + 1, y), w = at(x - 1, y);
      let id;
      if (!n && !w) id = set.TL;
      else if (!n && !e) id = set.TR;
      else if (!s && !w) id = set.BL;
      else if (!s && !e) id = set.BR;
      else if (!n) id = set.T;
      else if (!s) id = set.B;
      else if (!w) id = set.L;
      else if (!e) id = set.R;
      else if (!at(x - 1, y - 1)) id = set.iTL;
      else if (!at(x + 1, y - 1)) id = set.iTR;
      else if (!at(x - 1, y + 1)) id = set.iBL;
      else if (!at(x + 1, y + 1)) id = set.iBR;
      else id = set.C;
      map.put(layer, x, y, rpg(id));
    }
  }
  return (x, y) => at(x, y) === 1 && x >= 0 && y >= 0 && x < W && y < H;
}

/** Write a Tiled JSON map (both tilesets, standard layer order). */
export function writeMap(map, file, displayName) {
  let layerId = 1;
  const { W, H, L } = map;
  const tileLayer = (name, data, extra = {}) => ({ id: layerId++, name, type: "tilelayer", width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data, ...extra });
  // Terrain sits on the ground: merge it into the Ground layer (one less layer to draw).
  const ground = L.ground.map((g, i) => L.terrain[i] || g);
  const out = {
    type: "map", version: "1.10", tiledversion: "1.10.2", orientation: "orthogonal", renderorder: "right-down",
    infinite: false, width: W, height: H, tilewidth: 16, tileheight: 16, compressionlevel: -1,
    properties: [{ name: "displayName", type: "string", value: displayName }],
    tilesets: [
      { firstgid: RPG_FIRST, name: "rpg", image: "../art/kenney-roguelike-rpg/roguelikeSheet_transparent.png", imagewidth: 968, imageheight: 526, tilewidth: 16, tileheight: 16, margin: 0, spacing: 1, columns: RPG_COLS, tilecount: RPG_COLS * 31 },
      { firstgid: INDOOR_FIRST, name: "indoor", image: "../art/kenney-roguelike-indoors/roguelikeIndoor_transparent.png", imagewidth: 458, imageheight: 305, tilewidth: 16, tileheight: 16, margin: 0, spacing: 1, columns: 27, tilecount: 27 * 18 },
    ],
    layers: [
      tileLayer("Ground", ground),
      tileLayer("Walls", L.walls),
      tileLayer("Decor", L.decor),
      tileLayer("Furniture", L.furniture),
      tileLayer("Above", L.above),
      tileLayer("Collision", L.collision, { visible: false, opacity: 0.5 }),
      { id: layerId++, name: "Objects", type: "objectgroup", draworder: "topdown", opacity: 1, visible: true, x: 0, y: 0, objects: map.objects },
    ],
    nextlayerid: layerId,
    nextobjectid: map.nextId,
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out));
}
