import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import {
  Interpolator,
  MOVE_STEP_SECONDS,
  PLAYER_RADIUS,
  Predictor,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type Vec2,
} from "@talesreach/shared";
import { joinWorld } from "../net";
import type { UIScene } from "./UIScene";

/** Placeholder colours, indexed by the server-assigned colour number. */
const COLOURS = [0xe0b04a, 0x5fa8d3, 0xd46a5e, 0x7cc47a, 0xb48ad8, 0xe58fbf, 0x6fd1c4, 0xc9c9c9];

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
  body: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  interp: Interpolator;
}

const STEP_MS = MOVE_STEP_SECONDS * 1000;
/** After a hiccup, catch up at most this many steps in one frame (keeps us under the server's rate limit). */
const MAX_STEPS_PER_FRAME = 2;

export class WorldScene extends Phaser.Scene {
  private room: Room | null = null;
  private avatars = new Map<string, Avatar>();
  /** Your own character: predicted locally, corrected by the server. */
  private predictor: Predictor | null = null;
  /** Visual offset that fades out so server corrections never look like a jump. */
  private correction: Vec2 = { x: 0, y: 0 };
  private accumulator = 0;

  constructor() {
    super("world");
  }

  create() {
    this.drawGround();
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    // 2x zoom keeps characters and names readable on a phone in landscape.
    this.cameras.main.setZoom(2);
    this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.scene.launch("ui");
    void this.connect();
  }

  private drawGround() {
    const g = this.add.graphics();
    g.fillStyle(0x3d5a3a, 1).fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    g.lineStyle(1, 0x000000, 0.12);
    for (let x = 0; x <= WORLD_WIDTH; x += 32) g.lineBetween(x, 0, x, WORLD_HEIGHT);
    for (let y = 0; y <= WORLD_HEIGHT; y += 32) g.lineBetween(0, y, WORLD_WIDTH, y);
    g.lineStyle(4, 0x2a1f14, 1).strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  private async connect() {
    const say = (text: string) => {
      const el = document.getElementById("status");
      if (el) el.textContent = text;
    };
    say("The world is waking up…");
    try {
      const room = await joinWorld();
      this.room = room;
      say("Connected. Move with WASD / arrows, or drag on the left of the screen.");
      room.onMessage("pong", () => undefined);
      room.onMessage("rejected", () => undefined);
      room.onStateChange(() => this.onServerUpdate(room));
      room.onLeave(() => {
        this.room = null;
        say("Disconnected. Refresh to rejoin.");
      });
    } catch {
      say("Could not reach the world. Is the server running?");
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
          this.predictor = new Predictor({ x: p.x, y: p.y });
          this.cameras.main.startFollow(a.body, true, 0.2, 0.2);
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
      a.body.destroy();
      a.label.destroy();
      this.avatars.delete(id);
    }
  }

  override update(_time: number, deltaMs: number) {
    const room = this.room;
    if (!room) return;
    this.stepInput(room, deltaMs);
    this.draw(room);
  }

  /** Fixed-rate input: one message per server tick while you're moving. */
  private stepInput(room: Room, deltaMs: number) {
    const predictor = this.predictor;
    const ui = this.scene.get("ui") as UIScene;
    if (!predictor || !ui.moveInput) return;
    this.accumulator = Math.min(this.accumulator + deltaMs, STEP_MS * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      const dir = ui.moveInput.direction();
      if (dir.x === 0 && dir.y === 0) continue;
      room.send("input", predictor.push(dir));
    }
  }

  private draw(room: Room) {
    const now = performance.now();
    // Fade out any correction over a few frames.
    this.correction.x *= 0.8;
    this.correction.y *= 0.8;
    for (const [id, a] of this.avatars) {
      let pos: Vec2 | null;
      if (id === room.sessionId && this.predictor) {
        const p = this.predictor.position;
        pos = { x: p.x + this.correction.x, y: p.y + this.correction.y };
      } else {
        pos = a.interp.sample(now);
      }
      if (!pos) continue;
      a.body.setPosition(pos.x, pos.y);
      a.label.setPosition(pos.x, pos.y - PLAYER_RADIUS - 4);
    }
  }

  private createAvatar(p: PlayerView, isMe: boolean): Avatar {
    const colour = COLOURS[p.colour % COLOURS.length] ?? 0xffffff;
    const body = this.add.circle(p.x, p.y, PLAYER_RADIUS, colour).setDepth(10);
    if (isMe) body.setStrokeStyle(2, 0xffffff);
    const label = this.add
      .text(p.x, p.y - PLAYER_RADIUS - 4, isMe ? `${p.name} (you)` : p.name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#f3e6c8",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(11)
      .setResolution(4);
    return { body, label, interp: new Interpolator(100) };
  }
}
