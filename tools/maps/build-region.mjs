// Builds assets/maps/crossroads.tmj — the Crossroads region (first region, task 2.1):
// a town around the Crossroads Inn, forest to the north, farmland to the east and the
// edge of a marsh to the south-west, joined by roads. 128 x 128 tiles, streamed to
// players in 32 x 32-tile chunks. Interiors (the inn) are separate maps behind doors.
// Run: node tools/maps/build-region.mjs   (then node tools/maps/build-chunks.mjs)
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRT, WATER, createMap, makeNoise, makeRandom, paintTerrain, rpg, writeMap } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../assets/maps/crossroads.tmj");
const W = 128;
const H = 128;
const m = createMap(W, H);
const rand = makeRandom(4242);
const pick = (list) => list[Math.floor(rand() * list.length)];

const T = {
  grass: 5, grassAlt: 62, stone: 7, stoneAlt: 8,
  treeTop: 583, treeTrunk: 640, pineTop: 588, pineTrunk: 645, fruitTop: 593, fruitTrunk: 650,
  deadTop: 540, deadTrunk: 597, deadSmall: 654, bush: 526, berryBush: 594, orangeBush: 537, roundBush: 538,
  flowers: [541, 595, 652], tufts: [598, 655], sprouts: [592, 649], lily: 652,
  signpost: 19, signpostL: 20, signpostR: 21, barrel: 23, crate: 357, crate2: 358,
  awningRed: 10, awningGreen: 11, stallRed: 67, stallGreen: 68,
  // building exterior: flat roof (top / middle / eave rows), gable roof (3 wide), walls, door, windows
  roofTL: 1221, roofT: 1222, roofTR: 1223, roofL: 1278, roofM: 1279, roofR: 1280, eaveL: 1335, eave: 1336, eaveR: 1337,
  gableTL: 1217, gableT: 1222, gableTR: 1218, gableML: 1274, gableM: 1279, gableMR: 1275, gableBL: 1331, gableB: 1276, gableBR: 1332,
  wallUpL: 872, wallUp: 873, wallUpR: 874, wallLoL: 869, wallLo: 868, wallLoR: 871,
  door: 32, windowTop: 158, windowBottom: 215, torch: 416,
};

const noiseForest = makeNoise(11, 7);
const noiseMarsh = makeNoise(23, 6);
const noiseMeadow = makeNoise(37, 5);

// ---- base: grass everywhere ----
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.put("ground", x, y, rpg(rand() < 0.18 ? T.grassAlt : T.grass));

// ---- areas ----
const TOWN = { x0: 44, y0: 50, x1: 84, y1: 86 };
const inTown = (x, y) => x >= TOWN.x0 && x <= TOWN.x1 && y >= TOWN.y0 && y <= TOWN.y1;
const ROAD_X = [63, 64]; // north–south road
const ROAD_Y = [74, 75]; // east–west road
const nearRoad = (x, y, pad) => (x >= ROAD_X[0] - pad && x <= ROAD_X[1] + pad) || (y >= ROAD_Y[0] - pad && y <= ROAD_Y[1] + pad);

// Marsh (south-west): ponds of water with muddy banks.
const isMarsh = (x, y) => x < 44 && y > 82;
const pondAt = (x, y) => isMarsh(x, y) && !nearRoad(x, y, 3) && x > 2 && y < H - 3 && noiseMarsh(x, y) > 0.58;
const water = paintTerrain(m, pondAt, WATER);
// A village pond just north-east of the town square.
const villagePond = (x, y) => (x - 76) ** 2 / 16 + (y - 60) ** 2 / 9 <= 1;
const pond2 = paintTerrain(m, villagePond, WATER);
const isWater = (x, y) => water(x, y) || pond2(x, y);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isWater(x, y)) m.solid(x, y);

// Roads and the market square (dirt), with proper edges.
const isSquare = (x, y) => x >= 58 && x <= 70 && y >= 76 && y <= 84;
const roadMask = (x, y) => ROAD_X.includes(x) || ROAD_Y.includes(y) || isSquare(x, y) || (x >= 62 && x <= 65 && y >= 66 && y <= 74);
paintTerrain(m, (x, y) => roadMask(x, y) && !isWater(x, y), DIRT);

// Farm fields (east): tilled dirt plots with crops, hedges between them.
const FIELDS = [];
for (let fy = 0; fy < 3; fy++) {
  for (let fx = 0; fx < 3; fx++) {
    const x0 = 90 + fx * 11;
    const y0 = 54 + fy * 11;
    if (fy === 1 && fx === 0) continue; // farmhouse yard
    FIELDS.push({ x0, y0, x1: x0 + 7, y1: y0 + 6 });
  }
}
const inField = (x, y) => FIELDS.some((f) => x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1);
paintTerrain(m, (x, y) => inField(x, y) && !ROAD_Y.includes(y), DIRT);
for (const f of FIELDS) {
  // crop rows: sprouts on alternating rows
  for (let y = f.y0 + 1; y < f.y1; y += 2) for (let x = f.x0 + 1; x < f.x1; x++) if (rand() < 0.85) m.put("decor", x, y, rpg(pick(T.sprouts)));
  // hedge around the field (gap on the road side for the gate)
  for (let x = f.x0 - 1; x <= f.x1 + 1; x++) {
    for (const y of [f.y0 - 1, f.y1 + 1]) if (!(x === f.x0 + 3 || x === f.x0 + 4) && !ROAD_Y.includes(y)) m.put("furniture", x, y, rpg(T.bush), true);
  }
  for (let y = f.y0; y <= f.y1; y++) for (const x of [f.x0 - 1, f.x1 + 1]) if (!ROAD_Y.includes(y)) m.put("furniture", x, y, rpg(T.bush), true);
}

// ---- buildings ----
/** A building with a flat roof and a front wall (windows + door). Returns the door tile. */
function building(x0, y0, w, roofRows, { door = Math.floor(w / 2), windows = [] } = {}) {
  for (let r = 0; r < roofRows; r++) {
    const top = r === 0, eave = r === roofRows - 1;
    for (let x = x0; x < x0 + w; x++) {
      const left = x === x0, right = x === x0 + w - 1;
      const id = top ? (left ? T.roofTL : right ? T.roofTR : T.roofT) : eave ? (left ? T.eaveL : right ? T.eaveR : T.eave) : left ? T.roofL : right ? T.roofR : T.roofM;
      m.put("walls", x, y0 + r, rpg(id), true);
    }
  }
  const wy = y0 + roofRows;
  for (let x = x0; x < x0 + w; x++) {
    const left = x === x0, right = x === x0 + w - 1;
    m.put("walls", x, wy, rpg(left ? T.wallUpL : right ? T.wallUpR : T.wallUp), true);
    m.put("walls", x, wy + 1, rpg(left ? T.wallLoL : right ? T.wallLoR : T.wallLo), true);
  }
  for (const wx of windows) {
    m.put("decor", x0 + wx, wy, rpg(T.windowTop));
    m.put("decor", x0 + wx, wy + 1, rpg(T.windowBottom));
  }
  m.put("decor", x0 + door, wy + 1, rpg(T.door));
  return { x: x0 + door, y: wy + 1 };
}
/** A small cottage with a gable roof (3 wide). */
function cottage(x0, y0) {
  const g = [[T.gableTL, T.gableT, T.gableTR], [T.gableML, T.gableM, T.gableMR], [T.gableBL, T.gableB, T.gableBR]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m.put("walls", x0 + c, y0 + r, rpg(g[r][c]), true);
  for (let c = 0; c < 3; c++) {
    m.put("walls", x0 + c, y0 + 3, rpg(c === 0 ? T.wallUpL : c === 2 ? T.wallUpR : T.wallUp), true);
    m.put("walls", x0 + c, y0 + 4, rpg(c === 0 ? T.wallLoL : c === 2 ? T.wallLoR : T.wallLo), true);
  }
  m.put("decor", x0 + 1, y0 + 4, rpg(T.door));
}

// The Crossroads Inn (exterior). Its door leads inside (the inn interior map).
const inn = building(54, 52, 20, 9, { door: 9, windows: [2, 5, 13, 16] });
m.put("decor", inn.x - 1, inn.y, rpg(T.torch));
m.put("decor", inn.x + 2, inn.y, rpg(T.torch));
// The door tile itself is walkable so you can step into it (and inside).
m.clear(inn.x, inn.y);
m.clear(inn.x + 1, inn.y);
m.put("decor", inn.x + 1, inn.y, rpg(T.door));
// a short path from the door down to the road is part of roadMask (x 62..65, y 66..74)

// Cottages around the town, and a farmhouse.
for (const [x, y] of [[47, 62], [79, 66], [51, 78], [74, 78], [97, 66]]) cottage(x, y);

// Market stalls and a signpost at the crossroads.
for (const [x, y, red] of [[59, 78, true], [62, 78, false], [66, 78, true], [69, 78, false]]) {
  m.put("above", x, y, rpg(red ? T.awningRed : T.awningGreen));
  m.put("furniture", x, y + 1, rpg(red ? T.stallRed : T.stallGreen), true);
}
for (const [x, y] of [[60, 83], [61, 83], [68, 83]]) m.put("furniture", x, y, rpg(pick([T.barrel, T.crate, T.crate2])), true);
m.put("furniture", 66, 72, rpg(T.signpost), true);

// ---- trees, forest, marsh plants ----
function tree(x, y, kind) {
  if (m.isSolid(x, y) || m.isSolid(x, y - 1) || roadMask(x, y) || roadMask(x, y - 1) || inField(x, y)) return;
  if (m.get("walls", x, y - 1) || m.get("walls", x, y)) return;
  const [top, trunk] = kind === "pine" ? [T.pineTop, T.pineTrunk] : kind === "fruit" ? [T.fruitTop, T.fruitTrunk] : kind === "dead" ? [T.deadTop, T.deadTrunk] : [T.treeTop, T.treeTrunk];
  m.put("furniture", x, y, rpg(trunk), true);
  m.put("above", x, y - 1, rpg(top));
}
// The ancient grove: a clearing in the forest (the Hollow Stag lives here, task 2.6).
const GROVE = { x: 30, y: 18, r: 7 };
const inGrove = (x, y) => (x - GROVE.x) ** 2 + (y - GROVE.y) ** 2 <= GROVE.r ** 2;
for (let y = 1; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (inTown(x, y) || nearRoad(x, y, 1)) continue;
    const edge = x < 2 || x > W - 3 || y < 2 || y > H - 3;
    const forestNorth = y < 40 && noiseForest(x, y) > 0.38 && !inGrove(x, y);
    const meadow = !forestNorth && noiseMeadow(x, y) > 0.82 && rand() < 0.3;
    if (edge || (forestNorth && rand() < 0.55)) tree(x, y, rand() < 0.5 ? "pine" : "leafy");
    else if (isMarsh(x, y) && !isWater(x, y)) {
      if (rand() < 0.04) tree(x, y, "dead");
      else if (rand() < 0.18) m.put("decor", x, y, rpg(pick(T.tufts)));
    } else if (meadow && x > 86 && y > 40 && y < 50) tree(x, y, "fruit"); // orchard row by the farms
    else if (meadow) tree(x, y, rand() < 0.3 ? "pine" : "leafy");
    else if (!m.isSolid(x, y) && !roadMask(x, y) && !inField(x, y) && rand() < 0.035) m.put("decor", x, y, rpg(pick([...T.flowers, ...T.tufts])));
  }
}
// Lily pads on the ponds, flowers in the grove.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isWater(x, y) && rand() < 0.05) m.put("decor", x, y, rpg(T.lily));
for (let i = 0; i < 30; i++) {
  const a = rand() * Math.PI * 2, d = rand() * (GROVE.r - 1);
  const x = Math.round(GROVE.x + Math.cos(a) * d), y = Math.round(GROVE.y + Math.sin(a) * d);
  if (!m.isSolid(x, y)) m.put("decor", x, y, rpg(pick(T.flowers)));
}
// Bushes along the town edges.
for (let i = 0; i < 40; i++) {
  const x = TOWN.x0 + Math.floor(rand() * (TOWN.x1 - TOWN.x0));
  const y = TOWN.y0 + Math.floor(rand() * (TOWN.y1 - TOWN.y0));
  if (!m.isSolid(x, y) && !roadMask(x, y) && !m.get("walls", x, y) && !m.get("walls", x, y + 1) && !m.get("decor", x, y)) {
    m.put("furniture", x, y, rpg(pick([T.bush, T.berryBush, T.roundBush])), true);
  }
}

// ---- objects ----
// The inn door: step into it to go inside.
m.zone("inn_door", "door", inn.x, inn.y, 2, 1, { to: "inn", spot: "inn_entry" });
// Where you appear when you walk out of the inn.
m.point("inn_front", "arrival", inn.x, inn.y + 2);
// Areas: music, ambience and footsteps.
m.zone("grove", "zone", GROVE.x - GROVE.r, GROVE.y - GROVE.r, GROVE.r * 2 + 1, GROVE.r * 2 + 1, { mood: "forest", ambience: "forest", surface: "grass", name: "Ancient Grove" });
m.zone("forest", "zone", 0, 0, W, 40, { mood: "forest", ambience: "forest", surface: "grass", name: "Whisperwood" });
m.zone("marsh", "zone", 0, 83, 44, H - 83, { mood: "night", ambience: "forest", surface: "grass", name: "Fenmarsh Edge" });
m.zone("farms", "zone", 86, 46, W - 86, 50, { mood: "day", ambience: "forest", surface: "grass", name: "Brightfield Farms" });
m.zone("town", "zone", TOWN.x0, TOWN.y0, TOWN.x1 - TOWN.x0 + 1, TOWN.y1 - TOWN.y0 + 1, { mood: "day", ambience: "forest", surface: "grass", name: "Crossroads" });
m.zone("wilds", "zone", 0, 0, W, H, { mood: "day", ambience: "forest", surface: "grass", name: "The Crossroads" });
// Named places for later tasks (monster spawns, farm plots, quests).
m.point("grove_heart", "place", GROVE.x, GROVE.y);
m.point("well_square", "place", 64, 80);
m.point("farm_gate", "place", 94, 73);

writeMap(m, OUT, "The Crossroads");
console.log(`wrote ${OUT} (${W}x${H}, ${m.objects.length} objects)`);
