// Builds assets/maps/inn.tmj — inside the Crossroads Inn — as a Tiled map (an interior: you enter it
// through the inn's door in the Crossroads region, behind a short fade).
// The same file is drawn by the client and used for collision by the server.
// Run: node tools/maps/build-crossroads.mjs   (the result can also be opened and edited in Tiled)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../assets/maps/inn.tmj");

const W = 40;
const H = 20;
const RPG_COLS = 57;
const RPG_FIRST = 1;
const INDOOR_FIRST = 1 + RPG_COLS * 31; // 1768
const rpg = (id) => RPG_FIRST + id;
const indoor = (id) => INDOOR_FIRST + id;

// ---- tile ids (see docs/STYLE.md) ----
const T = {
  grass: 5, grassAlt: 62, dirt: 6, woodFloor: 119, woodFloorAlt: 120,
  // wall tops (seen from above)
  wTopL: 700, wTop: 698, wTopR: 701, wSide: 756, wJoinL: 757, wJoinR: 758, wCapL: 697, wCapR: 699,
  // wall faces under a top wall: upper and lower rows, with end pieces
  fUp: 873, fUpL: 872, fUpR: 874, fLo: 868, fLoL: 869, fLoR: 871,
  windowTop: 158, windowBottom: 215, door: 32,
  rugTL: 922, rugT: 923, rugTR: 924, rugL: 979, rugC: 980, rugR: 981, rugBL: 1036, rugB: 1037, rugBR: 1038,
  hearthLit: 13, oven: 14, barrel: 23, barrel2: 26, keg: 24,
  bedHead: 72, bedFoot: 129, bedHeadW: 74, bedFootW: 131,
  chairDown: 190, chairUp: 191, stool: 360,
  tableL: 361, tableM: 362, tableR: 364,
  candle: 418, chandelier: 475, torch: 416,
  crateFood: 357, crateFood2: 358, crateFood3: 359, crateOrange: 412,
  dresser: 308, shelf: 199, shelfBottom: 256,
  signpost: 19, signpostR: 21,
  treeTop: 583, treeTrunk: 640, pineTop: 588, pineTrunk: 645, bush: 526,
  flower: 541, sprout: 592, tuft: 598, tuft2: 655,
};
const I = { counter: 325, counterBottles: 329, counterBottles2: 330, counterEnd: 324 };

// ---- layers ----
const blank = () => new Array(W * H).fill(0);
const L = { ground: blank(), walls: blank(), decor: blank(), furniture: blank(), above: blank(), collision: blank() };
const at = (x, y) => y * W + x;
const put = (layer, x, y, gid, solid = false) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  L[layer][at(x, y)] = gid;
  if (solid) L.collision[at(x, y)] = rpg(T.wSide);
};
const solid = (x, y) => (L.collision[at(x, y)] = rpg(T.wSide));
const clear = (x, y) => (L.collision[at(x, y)] = 0);

// deterministic random so the map is the same every build
let seed = 1337;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ---- outside the walls: darkness, and solid (only the doorway leads out) ----
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) solid(x, y);
function tree() {}

// ---- the inn ----
const X0 = 4, X1 = 35, Y0 = 1, YB = 16; // outer wall-top box; YB = south wall-top row
// floor everywhere inside
for (let y = Y0 + 1; y < YB; y++) for (let x = X0 + 1; x < X1; x++) { put("ground", x, y, rpg(T.woodFloor)); clear(x, y); }

/** A horizontal wall: wall-top row at y, plus two rows of wall face below it (from x0 to x1). */
function hWall(x0, x1, y, { capL = T.wTop, capR = T.wTop } = {}) {
  for (let x = x0; x <= x1; x++) {
    put("walls", x, y, rpg(x === x0 ? capL : x === x1 ? capR : T.wTop), true);
    put("walls", x, y + 1, rpg(x === x0 ? T.fUpL : x === x1 ? T.fUpR : T.fUp), true);
    put("walls", x, y + 2, rpg(x === x0 ? T.fLoL : x === x1 ? T.fLoR : T.fLo), true);
  }
}
/** Something hung on a wall face (window, torch): drawn over the wall, still solid. */
function onWall(x, y, id) {
  put("decor", x, y, rpg(id));
  solid(x, y);
}
/** A vertical wall seen from above (one tile thick). */
function vWall(x, y0, y1) {
  for (let y = y0; y <= y1; y++) put("walls", x, y, rpg(T.wSide), true);
}

// outer walls
hWall(X0, X1, Y0, { capL: T.wTopL, capR: T.wTopR });
vWall(X0, Y0 + 1, YB);
vWall(X1, Y0 + 1, YB);
// fix the face end pieces next to the side walls
put("walls", X0, Y0 + 1, rpg(T.wSide), true); put("walls", X0, Y0 + 2, rpg(T.wSide), true);
put("walls", X1, Y0 + 1, rpg(T.wSide), true); put("walls", X1, Y0 + 2, rpg(T.wSide), true);
// south wall facing the courtyard, with the front door gap at x 19..20
hWall(X0, 18, YB, { capL: T.wJoinL, capR: T.wCapR });
hWall(21, X1, YB, { capL: T.wCapL, capR: T.wJoinR });
for (let y = YB; y <= YB + 2; y++) for (let x = 19; x <= 20; x++) { put("ground", x, y, rpg(T.woodFloor)); clear(x, y); }

// west wing: two rentable rooms (x 5..11), wall at x 12 with doorways
vWall(12, Y0 + 1, YB - 1);
hWall(5, 11, 8, { capL: T.wSide, capR: T.wSide });
put("walls", 12, 8, rpg(T.wSide), true);
for (const y of [6, 14]) { put("walls", 12, y, 0); clear(12, y); put("ground", 12, y, rpg(T.woodFloor)); }
// room A (north) and room B (south): bed, candle, dresser
put("furniture", 5, 4, rpg(T.bedHead), true); put("furniture", 5, 5, rpg(T.bedFoot), true);
put("furniture", 7, 4, rpg(T.dresser), true); put("decor", 6, 4, rpg(T.candle));
put("furniture", 5, 12, rpg(T.bedHeadW), true); put("furniture", 5, 13, rpg(T.bedFootW), true);
put("furniture", 7, 12, rpg(T.dresser), true); put("decor", 6, 12, rpg(T.candle));

// main hall (x 13..34): bar along the north-east, kegs behind it
for (let x = 25; x <= 32; x++) put("furniture", x, 6, indoor(x === 25 ? I.counterEnd : x % 3 === 0 ? I.counterBottles : I.counter), true);
put("furniture", 33, 6, indoor(I.counterBottles2), true);
for (const [x, g] of [[26, T.barrel], [27, T.keg], [28, T.barrel2], [31, T.barrel], [32, T.keg]]) put("furniture", x, 4, rpg(g), true);
put("furniture", 33, 4, rpg(T.crateFood), true); put("furniture", 34 - 1, 5, rpg(T.crateFood2), true);
// fireplace on the north wall of the hall, candles either side
put("furniture", 17, 4, rpg(T.hearthLit), true);
put("decor", 16, 4, rpg(T.candle)); put("decor", 18, 4, rpg(T.candle));
// windows and torches on the hall's north face
for (const x of [21, 23]) { onWall(x, 2, T.windowTop); onWall(x, 3, T.windowBottom); }
for (const x of [14, 30]) onWall(x, 3, T.torch);
// long tables with chairs
function longTable(x, y, len) {
  for (let i = 0; i < len; i++) {
    put("furniture", x + i, y, rpg(i === 0 ? T.tableL : i === len - 1 ? T.tableR : T.tableM), true);
    put("decor", x + i, y - 1, rpg(T.chairDown));
    put("decor", x + i, y + 1, rpg(T.chairUp));
  }
}
longTable(15, 9, 4);
longTable(25, 10, 4);
longTable(15, 13, 3);
// bard's corner: a rug and a stool near the west of the hall
for (let y = 11; y <= 13; y++) for (let x = 21; x <= 23; x++) {
  const top = y === 11, bot = y === 13, left = x === 21, right = x === 23;
  const id = top ? (left ? T.rugTL : right ? T.rugTR : T.rugT) : bot ? (left ? T.rugBL : right ? T.rugBR : T.rugB) : left ? T.rugL : right ? T.rugR : T.rugC;
  put("decor", x, y, rpg(id));
}
put("decor", 22, 12, rpg(T.stool));
// food crates and a dresser near the bar end
put("furniture", 33, 9, rpg(T.crateOrange), true);
put("furniture", 33, 13, rpg(T.crateFood3), true);
// windows on the outside (south) face, and lanterns by the door


// keep the doorway and the road clear of plants
for (let y = YB; y <= 23; y++) for (let x = 19; x <= 20; x++) { put("decor", x, y, 0); clear(x, y); }

// ---- objects: spawn points and NPC spots (used by later tasks) ----
const objects = [];
let nextId = 1;
const point = (name, type, tx, ty) => objects.push({ id: nextId++, name, type, point: true, x: tx * 16 + 8, y: ty * 16 + 8, rotation: 0, visible: true, width: 0, height: 0 });
point("player_spawn", "spawn", 19, 14);
point("player_spawn", "spawn", 20, 14);
point("player_spawn", "spawn", 18, 13);
point("player_spawn", "spawn", 21, 13);
point("innkeeper", "npc", 29, 5);
point("server", "npc", 20, 8);
point("bard", "npc", 22, 12);
point("room_a", "inn_room", 8, 5);
point("room_b", "inn_room", 8, 13);
point("fireplace", "light", 17, 4);
// NPC routine spots (task 1.7): where each member of staff goes during the day.
for (const [name, x, y] of [
  ["innkeeper_bar_1", 27, 5], ["innkeeper_bar_2", 31, 5], ["innkeeper_kegs", 29, 5], ["innkeeper_hearth", 19, 5],
  ["server_table_1", 19, 9], ["server_table_2", 24, 11], ["server_table_3", 29, 12], ["server_table_4", 19, 14],
  ["server_bar", 30, 7], ["server_rest", 32, 11],
  ["bard_stage", 22, 12], ["bard_practice_1", 15, 6], ["bard_practice_2", 26, 13], ["bard_practice_3", 20, 10], ["bard_room", 9, 14],
]) point(name, "npc_spot", x, y);
// zones: what music/ambience plays and what you walk on
const zone = (name, tx, ty, tw, th, props, type = "zone") =>
  objects.push({
    id: nextId++, name, type, x: tx * 16, y: ty * 16, width: tw * 16, height: th * 16, rotation: 0, visible: true,
    properties: Object.entries(props).map(([k, v]) => ({ name: k, type: "string", value: v })),
  });
zone("inn", X0, Y0, X1 - X0 + 1, YB - Y0 + 3, { mood: "tavern", ambience: "fire", surface: "wood" });
// The way out: stepping into the doorway takes you outside to the Crossroads region.
for (const x of [19, 20]) put("ground", x, 19, rpg(T.woodFloor));
zone("inn_exit", 19, 18, 2, 2, { to: "crossroads", spot: "inn_front" }, "door");
point("inn_entry", "arrival", 19, 15);

// ---- write Tiled JSON ----
let layerId = 1;
const tileLayer = (name, data, extra = {}) => ({ id: layerId++, name, type: "tilelayer", width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data, ...extra });
const map = {
  type: "map",
  version: "1.10",
  tiledversion: "1.10.2",
  orientation: "orthogonal",
  renderorder: "right-down",
  infinite: false,
  width: W,
  height: H,
  tilewidth: 16,
  tileheight: 16,
  compressionlevel: -1,
  properties: [{ name: "displayName", type: "string", value: "The Crossroads Inn" }],
  tilesets: [
    { firstgid: RPG_FIRST, name: "rpg", image: "../art/kenney-roguelike-rpg/roguelikeSheet_transparent.png", imagewidth: 968, imageheight: 526, tilewidth: 16, tileheight: 16, margin: 0, spacing: 1, columns: RPG_COLS, tilecount: RPG_COLS * 31 },
    { firstgid: INDOOR_FIRST, name: "indoor", image: "../art/kenney-roguelike-indoors/roguelikeIndoor_transparent.png", imagewidth: 458, imageheight: 305, tilewidth: 16, tileheight: 16, margin: 0, spacing: 1, columns: 27, tilecount: 27 * 18 },
  ],
  layers: [
    tileLayer("Ground", L.ground),
    tileLayer("Walls", L.walls),
    tileLayer("Decor", L.decor),
    tileLayer("Furniture", L.furniture),
    tileLayer("Above", L.above),
    tileLayer("Collision", L.collision, { visible: false, opacity: 0.5 }),
    { id: layerId++, name: "Objects", type: "objectgroup", draworder: "topdown", opacity: 1, visible: true, x: 0, y: 0, objects },
  ],
  nextlayerid: layerId,
  nextobjectid: nextId,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(map));
console.log(`wrote ${OUT} (${W}x${H}, ${objects.length} objects)`);
