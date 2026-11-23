/**
 * Tiled map helpers shared by server and client: the same .tmj file gives the
 * collision grid (server-authoritative movement + client prediction), spawn
 * points, NPC spots and zones (music, footstep surface).
 */

export interface MapPoint {
  name: string;
  type: string;
  x: number;
  y: number;
}

export interface MapZone {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  props: Record<string, string | number | boolean>;
}

export interface CollisionGrid {
  width: number;
  height: number;
  tile: number;
  /** 1 = blocked, 0 = walkable; row-major, width * height. */
  blocked: Uint8Array;
}

export interface GameMap {
  name: string;
  grid: CollisionGrid;
  points: MapPoint[];
  zones: MapZone[];
  /** Size in world pixels. */
  pixelWidth: number;
  pixelHeight: number;
}

interface TiledProperty {
  name: string;
  value: string | number | boolean;
}
interface TiledObject {
  name?: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  point?: boolean;
  properties?: TiledProperty[];
}
interface TiledLayer {
  name: string;
  type: string;
  data?: number[];
  objects?: TiledObject[];
}
interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  layers: TiledLayer[];
  properties?: TiledProperty[];
}

/** Read a Tiled JSON map (already parsed). Throws if it has no Collision layer. */
export function parseTiledMap(json: unknown): GameMap {
  const m = json as TiledMap;
  if (!m || typeof m.width !== "number" || !Array.isArray(m.layers)) throw new Error("not a Tiled map");
  const collision = m.layers.find((l) => l.type === "tilelayer" && l.name === "Collision");
  if (!collision?.data || collision.data.length !== m.width * m.height) throw new Error("map has no Collision layer");
  const blocked = new Uint8Array(m.width * m.height);
  collision.data.forEach((gid, i) => (blocked[i] = gid ? 1 : 0));

  const points: MapPoint[] = [];
  const zones: MapZone[] = [];
  for (const layer of m.layers) {
    if (layer.type !== "objectgroup" || !layer.objects) continue;
    for (const o of layer.objects) {
      const type = o.type ?? o.class ?? "";
      const name = o.name ?? "";
      if (o.point) points.push({ name, type, x: o.x, y: o.y });
      else if (o.width && o.height) {
        const props: MapZone["props"] = {};
        for (const p of o.properties ?? []) props[p.name] = p.value;
        zones.push({ name, x: o.x, y: o.y, width: o.width, height: o.height, props });
      }
    }
  }
  const displayName = m.properties?.find((p) => p.name === "displayName")?.value;
  return {
    name: typeof displayName === "string" ? displayName : "",
    grid: { width: m.width, height: m.height, tile: m.tilewidth, blocked },
    points,
    zones,
    pixelWidth: m.width * m.tilewidth,
    pixelHeight: m.height * m.tilewidth,
  };
}

export function isBlockedTile(grid: CollisionGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.blocked[ty * grid.width + tx] === 1;
}

/**
 * The part of a character that collides: a small box around the feet
 * (x - 4 .. x + 4, y - 3 .. y + 2), so heads can overlap walls above them.
 */
export const FEET = { left: 4, right: 4, up: 3, down: 2 } as const;

export function feetBlocked(grid: CollisionGrid, x: number, y: number): boolean {
  const t = grid.tile;
  const x0 = Math.floor((x - FEET.left) / t);
  const x1 = Math.floor((x + FEET.right - 0.001) / t);
  const y0 = Math.floor((y - FEET.up) / t);
  const y1 = Math.floor((y + FEET.down - 0.001) / t);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isBlockedTile(grid, tx, ty)) return true;
  return false;
}

export function zoneAt(map: GameMap, x: number, y: number): MapZone | undefined {
  return map.zones.find((z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height);
}

/**
 * Shortest walkable route between two points (A* over tiles, 8 directions,
 * no cutting corners). Returns tile-centre waypoints, excluding the start;
 * empty if unreachable. Bounded so a bad request can't burn CPU.
 */
export function findPath(grid: CollisionGrid, from: { x: number; y: number }, to: { x: number; y: number }, maxNodes = 4000) {
  const t = grid.tile;
  const sx = Math.floor(from.x / t);
  const sy = Math.floor(from.y / t);
  let gx = Math.floor(to.x / t);
  let gy = Math.floor(to.y / t);
  // Tapped on a wall or table: aim for the nearest open tile instead.
  if (isBlockedTile(grid, gx, gy)) {
    const near = nearestOpenTile(grid, gx, gy, 3);
    if (!near) return [];
    [gx, gy] = near;
  }
  const W = grid.width;
  const key = (x: number, y: number) => y * W + x;
  const goal = key(gx, gy);
  const open: number[] = [key(sx, sy)];
  const g = new Map<number, number>([[key(sx, sy), 0]]);
  const f = new Map<number, number>([[key(sx, sy), Math.hypot(gx - sx, gy - sy)]]);
  const came = new Map<number, number>();
  const closed = new Set<number>();
  let visited = 0;
  while (open.length && visited++ < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if ((f.get(open[i]!) ?? Infinity) < (f.get(open[bi]!) ?? Infinity)) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    if (cur === goal) {
      const path: { x: number; y: number }[] = [];
      for (let k: number | undefined = cur; k !== undefined && k !== key(sx, sy); k = came.get(k)) {
        path.push({ x: (k % W) * t + t / 2, y: Math.floor(k / W) * t + t / 2 });
      }
      return path.reverse();
    }
    closed.add(cur);
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isBlockedTile(grid, nx, ny)) continue;
      if (dx && dy && (isBlockedTile(grid, cx + dx, cy) || isBlockedTile(grid, cx, cy + dy))) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = (g.get(cur) ?? 0) + (dx && dy ? Math.SQRT2 : 1);
      if (ng >= (g.get(nk) ?? Infinity)) continue;
      came.set(nk, cur);
      g.set(nk, ng);
      f.set(nk, ng + Math.hypot(gx - nx, gy - ny));
      if (!open.includes(nk)) open.push(nk);
    }
  }
  return [];
}

function nearestOpenTile(grid: CollisionGrid, tx: number, ty: number, radius: number): [number, number] | null {
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isBlockedTile(grid, tx + dx, ty + dy)) return [tx + dx, ty + dy];
      }
    }
  }
  return null;
}
