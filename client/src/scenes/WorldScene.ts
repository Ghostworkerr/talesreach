import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import {
  Interpolator,
  MOVE_STEP_SECONDS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  Predictor,
  findPath,
  parseTiledMap,
  stepMovement,
  zoneAt,
  type GameMap,
  type MapZone,
  type Vec2,
} from "@talesreach/shared";
import { isAuthError, joinWorld, wakeServer } from "../net";
import { account } from "../account";
import { showAgeGate } from "../ui/ageGate";
import { WORLD_ZOOM } from "../display";
import { MAPS, READY_MADE_CHARACTERS, SHEETS, loadArt } from "../art";
import type { UIScene } from "./UIScene";
import { CharacterView, snap } from "../character";
import { audio, type AmbienceLayer, type Mood, type Surface } from "../audio";

/** Shape of the state the server sends (kept loose: the server owns it). */
interface PlayerView {
  name: string;
  colour: number;
  x: number;
  y: number;
  ack: number;
}
interface WorldView {
  players: {
    forEach(cb: (p: PlayerView, id: string) => void): void;
    get(id: string): PlayerView | undefined;
  };
}

interface Avatar {
  view: CharacterView;
  label: Phaser.GameObjects.Text;
  interp: Interpolator;
}

const STEP_MS = MOVE_STEP_SECONDS * 1000;
const STEP_PX = PLAYER_SPEED * MOVE_STEP_SECONDS;
/** After a hiccup, catch up at most this many steps in one frame (keeps us under the server's rate limit). */
const MAX_STEPS_PER_FRAME = 2;
/** Draw order: map layers below characters, tree tops above, names on top of everything. */
const DEPTH = { ground: 0, walls: 1, decor: 2, furniture: 3, above: 100_000, labels: 200_000, marker: 2.5 } as const;

export class WorldScene extends Phaser.Scene {
  private room: Room | null = null;
  private avatars = new Map<string, Avatar>();
  private map!: GameMap;
  /** Your own character: predicted locally, corrected by the server. */
  private predictor: Predictor | null = null;
  /** Visual offset that fades out so server corrections never look like a jump. */
  private correction: Vec2 = { x: 0, y: 0 };
  private accumulator = 0;
  /** Direction used for the step in progress (for smooth drawing between steps). */
  private stepDir: Vec2 = { x: 0, y: 0 };
  /** Tap-to-move route (world-pixel waypoints) and how long we've made no progress. */
  private path: Vec2[] = [];
  private stuckMs = 0;
  private lastPathPos: Vec2 | null = null;
  private zone: MapZone | undefined;
  private surface: Surface = "wood";

  constructor() {
    super("world");
  }

  preload() {
    loadArt(this);
  }

  create() {
    this.buildMap();
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.map.pixelWidth, this.map.pixelHeight);
    cam.setZoom(WORLD_ZOOM);
    const spawn = this.map.points.find((p) => p.type === "spawn");
    cam.centerOn(spawn?.x ?? this.map.pixelWidth / 2, spawn?.y ?? this.map.pixelHeight / 2);
    this.scene.launch("ui");
    // The UI scene starts on the next tick; hook its taps once it exists.
    this.events.once(Phaser.Scenes.Events.UPDATE, () => this.hookTaps());
    void this.connect();
  }

  /** Draw the Tiled map in layers; the server uses the same file for collision. */
  private buildMap() {
    const tm = this.make.tilemap({ key: MAPS.crossroads.key });
    const sets = [tm.addTilesetImage("rpg", SHEETS.rpg.key), tm.addTilesetImage("indoor", SHEETS.indoor.key)].filter(
      (t): t is Phaser.Tilemaps.Tileset => t !== null,
    );
    const layer = (name: string, depth: number) => tm.createLayer(name, sets, 0, 0)?.setDepth(depth);
    layer("Ground", DEPTH.ground);
    layer("Walls", DEPTH.walls);
    layer("Decor", DEPTH.decor);
    layer("Furniture", DEPTH.furniture);
    layer("Above", DEPTH.above);
    this.map = parseTiledMap(this.cache.tilemap.get(MAPS.crossroads.key).data);
  }

  private hookTaps() {
    const ui = this.scene.get("ui") as UIScene;
    if (!ui.moveInput) {
      this.time.delayedCall(50, () => this.hookTaps());
      return;
    }
    ui.moveInput.onTap((sx, sy) => this.walkTo(this.cameras.main.getWorldPoint(sx, sy)));
  }

  /** Tap-to-move: plan a route around walls and furniture, and show where we're going. */
  private walkTo(target: Vec2) {
    if (!this.predictor) return;
    const route = findPath(this.map.grid, this.predictor.position, target);
    if (route.length === 0) {
      audio.play("error", { volume: 0.4 });
      return;
    }
    // End exactly where tapped if that spot is open, else at the nearest open tile centre.
    const t = this.map.grid.tile;
    const last = route[route.length - 1]!;
    if (Math.floor(target.x / t) === Math.floor(last.x / t) && Math.floor(target.y / t) === Math.floor(last.y / t)) {
      route[route.length - 1] = { x: target.x, y: target.y };
    }
    this.path = route;
    this.stuckMs = 0;
    this.lastPathPos = null;
    this.showMarker(route[route.length - 1]!);
  }

  /** A small ring that pulses where you tapped (every action is animated). */
  private showMarker(p: Vec2) {
    const ring = this.add.ellipse(snap(p.x), snap(p.y + 2), 12, 6).setStrokeStyle(1, 0xfff3c4, 0.9).setDepth(DEPTH.marker);
    this.tweens.add({
      targets: ring,
      scaleX: 0.3,
      scaleY: 0.3,
      alpha: 0,
      duration: 500,
      ease: "Quad.easeIn",
      onComplete: () => ring.destroy(),
    });
  }

  private async connect() {
    const say = (text: string) => {
      const el = document.getElementById("status");
      if (el) el.textContent = text;
    };
    const uiRoot = document.getElementById("ui");
    const waiting = (secs: number) =>
      say(`The world is waking up… (${secs}s — the free server sleeps when nobody plays, this can take a minute)`);
    try {
      say("The world is waking up…");
      await wakeServer(waiting);
      let room: Room | null = null;
      for (let attempt = 0; attempt < 3 && !room; attempt++) {
        // First visit (or the account was lost): date of birth, then a guest account.
        if (!account.token && uiRoot) {
          say("");
          await showAgeGate(uiRoot);
        }
        say("The world is waking up…");
        try {
          room = await joinWorld(account.token ?? "", waiting);
        } catch (err) {
          if (!isAuthError(err)) throw err;
          // The server forgot this device (e.g. it restarted without a database): quietly re-register.
          await account.recover();
        }
      }
      if (!room) throw new Error("could not sign in");
      this.room = room;
      say("Welcome to the Crossroads Inn. Move with WASD / arrows, drag on the left, or tap where to go.");
      room.onMessage("pong", () => undefined);
      room.onMessage("rejected", () => undefined);
      room.onStateChange(() => this.onServerUpdate(room));
      room.onLeave(() => {
        this.room = null;
        say("Disconnected. Refresh to rejoin.");
      });
    } catch {
      say("Could not reach the world. Please try again in a few minutes.");
    }
  }

  /** Runs every time a server update arrives. */
  private onServerUpdate(room: Room) {
    const state = room.state as WorldView | undefined;
    if (!state?.players) return;
    const now = performance.now();
    const seen = new Set<string>();

    state.players.forEach((p, id) => {
      seen.add(id);
      const isMe = id === room.sessionId;
      let a = this.avatars.get(id);
      if (!a) {
        a = this.createAvatar(p, isMe);
        this.avatars.set(id, a);
        if (isMe) {
          this.predictor = new Predictor({ x: p.x, y: p.y }, this.map.grid);
          this.cameras.main.startFollow(a.view.root, true, 1, 1);
        }
      }
      if (isMe && this.predictor) {
        const fix = this.predictor.reconcile({ x: p.x, y: p.y }, p.ack);
        this.correction.x -= fix.x;
        this.correction.y -= fix.y;
      } else {
        a.interp.add(now, { x: p.x, y: p.y });
      }
    });

    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      a.view.destroy();
      a.label.destroy();
      this.avatars.delete(id);
    }
  }

  override update(_time: number, deltaMs: number) {
    const room = this.room;
    if (!room) return;
    this.stepInput(room, deltaMs);
    this.draw(room, deltaMs);
    this.updateZone();
  }

  /** Which way to walk this step: keys/joystick win; otherwise follow a tap-to-move route. */
  private wantedDirection(deltaMs: number): Vec2 {
    const ui = this.scene.get("ui") as UIScene;
    const manual = ui.moveInput?.direction() ?? { x: 0, y: 0 };
    if (manual.x !== 0 || manual.y !== 0) {
      this.path = [];
      return manual;
    }
    const me = this.predictor?.position;
    if (!me || this.path.length === 0) return { x: 0, y: 0 };
    // Drop waypoints we've reached (within a step).
    while (this.path.length) {
      const wp = this.path[0]!;
      const d = Math.hypot(wp.x - me.x, wp.y - me.y);
      if (d > (this.path.length === 1 ? 1.5 : STEP_PX)) break;
      this.path.shift();
    }
    const wp = this.path[0];
    if (!wp) return { x: 0, y: 0 };
    // Give up if something (another player, a wall corner) keeps us from moving.
    if (this.lastPathPos && Math.hypot(me.x - this.lastPathPos.x, me.y - this.lastPathPos.y) < 0.1) {
      this.stuckMs += deltaMs;
      if (this.stuckMs > 600) {
        this.path = [];
        return { x: 0, y: 0 };
      }
    } else this.stuckMs = 0;
    this.lastPathPos = { ...me };
    const dx = wp.x - me.x;
    const dy = wp.y - me.y;
    const d = Math.hypot(dx, dy);
    // Last waypoint: slow the final step so we stop on the spot instead of overshooting.
    const scale = this.path.length === 1 && d < STEP_PX ? d / STEP_PX : 1;
    return { x: Math.round((dx / d) * scale * 100) / 100, y: Math.round((dy / d) * scale * 100) / 100 };
  }

  /**
   * Fixed-rate input: one message per server tick while you're moving.
   * Starts counting the moment you press, so movement begins at once.
   */
  private stepInput(room: Room, deltaMs: number) {
    const predictor = this.predictor;
    if (!predictor) return;
    const dir = this.wantedDirection(deltaMs);
    if (dir.x === 0 && dir.y === 0) {
      // Let go: finish a step that was mostly done, so you don't slide back.
      const wasMoving = this.stepDir.x !== 0 || this.stepDir.y !== 0;
      if (wasMoving && this.accumulator >= STEP_MS / 2) room.send("input", predictor.push(this.stepDir));
      this.accumulator = 0;
      this.stepDir = { x: 0, y: 0 };
      return;
    }
    this.stepDir = dir;
    this.accumulator = Math.min(this.accumulator + deltaMs, STEP_MS * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      room.send("input", predictor.push(dir));
    }
  }

  private draw(room: Room, deltaMs: number) {
    const now = performance.now();
    // Fade out any server correction over a few frames.
    this.correction.x *= 0.8;
    this.correction.y *= 0.8;
    for (const [id, a] of this.avatars) {
      let pos: Vec2 | null;
      if (id === room.sessionId && this.predictor) {
        // Glide through the step in progress (drawn every frame, not just 20 times a second).
        const base = this.predictor.position;
        const ahead = stepMovement(base, this.stepDir, this.accumulator / 1000, this.map.grid);
        pos = { x: ahead.x + this.correction.x, y: ahead.y + this.correction.y };
      } else {
        pos = a.interp.sample(now);
      }
      if (!pos) continue;
      // Walk/idle animation, facing, depth and pixel snapping all happen in the view.
      a.view.update(pos.x, pos.y, deltaMs);
      a.label.setPosition(snap(pos.x), snap(pos.y - PLAYER_RADIUS - 6)).setDepth(DEPTH.labels);
    }
  }

  /** Music, ambience and footstep sound follow where you are (inside the inn or outdoors). */
  private updateZone() {
    const me = this.predictor?.position;
    if (!me) return;
    const zone = zoneAt(this.map, me.x, me.y);
    if (zone === this.zone) return;
    this.zone = zone;
    const mood = (zone?.props.mood as Mood | undefined) ?? "day";
    const amb = (zone?.props.ambience as AmbienceLayer | undefined) ?? "forest";
    this.surface = (zone?.props.surface as Surface | undefined) ?? "grass";
    audio.setMood(mood);
    audio.setAmbience({ [amb]: 1 });
  }

  private createAvatar(p: PlayerView, isMe: boolean): Avatar {
    const frame = READY_MADE_CHARACTERS[p.colour % READY_MADE_CHARACTERS.length] ?? READY_MADE_CHARACTERS[0];
    const view = new CharacterView(this, frame, p.x, p.y, isMe, isMe ? () => audio.footstep(this.surface) : undefined);
    const label = this.add
      .text(p.x, p.y - PLAYER_RADIUS - 4, isMe ? `${p.name} (you)` : p.name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#f3e6c8",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.labels)
      .setResolution(WORLD_ZOOM);
    return { view, label, interp: new Interpolator(100) };
  }
}
