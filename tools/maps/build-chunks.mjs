// Cuts every Tiled map in assets/maps into streamable pieces for the client (task 2.1):
//   assets/maps/<name>/meta.json      collision + objects (small; the client needs all of it)
//   assets/maps/<name>/<cx>_<cy>.json the visible tile layers of one 32 x 32-tile chunk
// The server keeps reading the whole .tmj. Run after any map generator:
//   node tools/maps/build-chunks.mjs
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CHUNK_TILES = 32; // same as shared/src/constants.ts
export const VISIBLE_LAYERS = ["Ground", "Walls", "Decor", "Furniture", "Above"];

const here = dirname(fileURLToPath(import.meta.url));
const MAPS = resolve(here, "../../assets/maps");

export function chunkMap(tmj) {
  const W = tmj.width;
  const H = tmj.height;
  const cols = Math.ceil(W / CHUNK_TILES);
  const rows = Math.ceil(H / CHUNK_TILES);
  const meta = {
    ...tmj,
    // Visible layers are left out (they come in chunks); collision and objects stay.
    layers: tmj.layers.filter((l) => !VISIBLE_LAYERS.includes(l.name)),
    properties: [...(tmj.properties ?? []).filter((p) => p.name !== "chunks"), { name: "chunks", type: "string", value: `${CHUNK_TILES}:${cols}x${rows}` }],
  };
  const chunks = new Map();
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * CHUNK_TILES;
      const y0 = cy * CHUNK_TILES;
      const w = Math.min(CHUNK_TILES, W - x0);
      const h = Math.min(CHUNK_TILES, H - y0);
      const layers = {};
      for (const name of VISIBLE_LAYERS) {
        const layer = tmj.layers.find((l) => l.name === name && l.type === "tilelayer");
        if (!layer) continue;
        const rowsOut = [];
        let any = false;
        for (let y = 0; y < h; y++) {
          const row = layer.data.slice((y0 + y) * W + x0, (y0 + y) * W + x0 + w);
          if (row.some((g) => g)) any = true;
          rowsOut.push(row);
        }
        if (any) layers[name] = rowsOut;
      }
      chunks.set(`${cx}_${cy}`, { x: x0, y: y0, w, h, layers });
    }
  }
  return { meta, chunks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of readdirSync(MAPS).filter((f) => f.endsWith(".tmj"))) {
    const name = file.replace(/\.tmj$/, "");
    const { meta, chunks } = chunkMap(JSON.parse(readFileSync(resolve(MAPS, file), "utf8")));
    const dir = resolve(MAPS, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "meta.json"), JSON.stringify(meta));
    for (const [key, chunk] of chunks) writeFileSync(resolve(dir, `${key}.json`), JSON.stringify(chunk));
    console.log(`${name}: meta + ${chunks.size} chunks`);
  }
}
