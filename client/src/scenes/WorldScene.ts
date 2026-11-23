import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import { PLAYER_RADIUS, WORLD_HEIGHT, WORLD_WIDTH, type Vec2 } from "@talesreach/shared";
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
}
interface WorldView {
  players: { forEach(cb: (p: PlayerView, id: string) => void): void };
}

interface Avatar {
  body: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
}

/** Most input messages per second the client will send (server allows 30). */
const SEND_PER_SECOND = 15;

export class WorldScene extends Phaser.Scene {
  private room: Room | null = null;
  private avatars = new Map<string, Avatar>();
  private lastSent: Vec2 = { x: 0, y: 0 };
  private lastSentAt = 0;

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
      room.onLeave(() => {
        this.room = null;
        say("Disconnected. Refresh to rejoin.");
      });
    } catch {
      say("Could not reach the world. Is the server running?");
    }
  }

  override update(time: number) {
    const room = this.room;
    if (!room) return;
    this.sendInput(room, time);
    this.syncAvatars(room);
  }

  /** Send the walking direction when it changes (throttled). */
  private sendInput(room: Room, now: number) {
    const ui = this.scene.get("ui") as UIScene;
    if (!ui.moveInput) return;
    const dir = ui.moveInput.direction();
    const changed = dir.x !== this.lastSent.x || dir.y !== this.lastSent.y;
    if (!changed || now - this.lastSentAt < 1000 / SEND_PER_SECOND) return;
    room.send("input", dir);
    this.lastSent = dir;
    this.lastSentAt = now;
  }

  /** Create, move and remove circles to match the server's player list. */
  private syncAvatars(room: Room) {
    const state = room.state as WorldView | undefined;
    if (!state?.players) return;
    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      seen.add(id);
      let a = this.avatars.get(id);
      if (!a) {
        a = this.createAvatar(p, id === room.sessionId);
        this.avatars.set(id, a);
        if (id === room.sessionId) this.cameras.main.startFollow(a.body, true, 0.15, 0.15);
      }
      // Simple smoothing toward the server position (proper prediction comes in task 0.3).
      const t = 0.35;
      a.body.x += (p.x - a.body.x) * t;
      a.body.y += (p.y - a.body.y) * t;
      a.label.setPosition(a.body.x, a.body.y - PLAYER_RADIUS - 4);
    });
    for (const [id, a] of this.avatars) {
      if (seen.has(id)) continue;
      a.body.destroy();
      a.label.destroy();
      this.avatars.delete(id);
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
    return { body, label };
  }
}
