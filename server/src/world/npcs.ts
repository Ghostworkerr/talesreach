import { findPath, worldTime, type GameMap, type MapPoint } from "@talesreach/shared";

/**
 * Inn staff with daily routines (server-only data). Each routine covers a span
 * of world hours; the NPC walks between its spots and pauses at each one.
 */
export interface Routine {
  /** World hours [from, to); `to` may be smaller than `from` to wrap past midnight. */
  from: number;
  to: number;
  activity: "working" | "serving" | "resting" | "performing" | "wandering" | "sleeping";
  spots: string[];
  /** Seconds to linger at each spot (min, max). */
  pause: [number, number];
}

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  /** Ready-made character frame from the Kenney character sheet. */
  frame: number;
  start: string;
  routines: Routine[];
}

export const NPC_DEFS: NpcDef[] = [
  {
    id: "innkeeper",
    name: "Marta",
    title: "Innkeeper",
    frame: 433,
    start: "innkeeper",
    routines: [
      { from: 6, to: 23, activity: "working", spots: ["innkeeper", "innkeeper_bar_1", "innkeeper_kegs", "innkeeper_bar_2", "innkeeper"], pause: [5, 12] },
      { from: 23, to: 6, activity: "resting", spots: ["innkeeper_hearth"], pause: [40, 90] },
    ],
  },
  {
    id: "server",
    name: "Tobin",
    title: "Server",
    frame: 325,
    start: "server",
    routines: [
      { from: 8, to: 22, activity: "serving", spots: ["server_table_1", "server_bar", "server_table_2", "server_table_3", "server_bar", "server_table_4"], pause: [2, 6] },
      { from: 22, to: 8, activity: "resting", spots: ["server_rest"], pause: [40, 90] },
    ],
  },
  {
    id: "bard",
    name: "Lark",
    title: "Bard",
    frame: 379,
    start: "bard",
    routines: [
      { from: 18, to: 2, activity: "performing", spots: ["bard_stage"], pause: [60, 120] },
      { from: 2, to: 9, activity: "sleeping", spots: ["bard_room"], pause: [60, 120] },
      { from: 9, to: 18, activity: "wandering", spots: ["bard_garden_1", "bard_crossroads", "bard_garden_2", "bard_crossroads"], pause: [6, 14] },
    ],
  },
];

/** NPCs stroll a little slower than players. */
export const NPC_SPEED = 38;

export function routineAt(def: NpcDef, hour: number): Routine {
  const inSpan = (r: Routine) => (r.from <= r.to ? hour >= r.from && hour < r.to : hour >= r.from || hour < r.to);
  return def.routines.find(inSpan) ?? def.routines[0]!;
}

/** Live state of one NPC on the server. */
export class NpcBrain {
  x: number;
  y: number;
  activity: Routine["activity"];
  private routine: Routine | null = null;
  private spotIndex = 0;
  private path: { x: number; y: number }[] = [];
  private pauseLeft = 0;

  constructor(
    readonly def: NpcDef,
    private readonly map: GameMap,
    private readonly rand: () => number = Math.random,
  ) {
    const start = this.spot(def.start) ?? { x: map.pixelWidth / 2, y: map.pixelHeight / 2 };
    this.x = start.x;
    this.y = start.y;
    this.activity = def.routines[0]!.activity;
  }

  private spot(name: string): MapPoint | undefined {
    return this.map.points.find((p) => p.name === name);
  }

  /** Advance by dt seconds at the given server time. */
  update(dt: number, nowMs: number) {
    const routine = routineAt(this.def, worldTime(nowMs).hour);
    if (routine !== this.routine) {
      // New part of the day: head for the first spot of the new routine straight away.
      this.routine = routine;
      this.activity = routine.activity;
      this.spotIndex = 0;
      this.pauseLeft = 0;
      this.planTo(routine.spots[0]!);
    }
    if (this.path.length === 0) {
      this.pauseLeft -= dt;
      if (this.pauseLeft > 0) return;
      this.spotIndex = (this.spotIndex + 1) % routine.spots.length;
      this.planTo(routine.spots[this.spotIndex]!);
      if (this.path.length === 0) this.linger(routine); // already there
      return;
    }
    let budget = NPC_SPEED * dt;
    while (budget > 0 && this.path.length) {
      const wp = this.path[0]!;
      const dx = wp.x - this.x;
      const dy = wp.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        this.x = wp.x;
        this.y = wp.y;
        budget -= d;
        this.path.shift();
        if (this.path.length === 0) this.linger(routine);
      } else {
        this.x += (dx / d) * budget;
        this.y += (dy / d) * budget;
        budget = 0;
      }
    }
  }

  private planTo(spotName: string) {
    const target = this.spot(spotName);
    if (!target) {
      this.path = [];
      return;
    }
    if (Math.hypot(target.x - this.x, target.y - this.y) < 1) {
      this.path = [];
      return;
    }
    const route = findPath(this.map.grid, this, target);
    // Finish exactly on the spot.
    if (route.length) route[route.length - 1] = { x: target.x, y: target.y };
    this.path = route;
  }

  private linger(routine: Routine) {
    const [min, max] = routine.pause;
    this.pauseLeft = min + this.rand() * (max - min);
  }

  get moving(): boolean {
    return this.path.length > 0;
  }
}
