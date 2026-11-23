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
import { READY_MADE_CHARACTERS, RPG, SHEETS, TILE, loadArt } from "../art";
import type { UIScene } from "./UIScene";

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
  body: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  interp: Interpolator;
}

const STEP_MS = MOVE_STEP_SECONDS * 1000;
/** Tiles of forest drawn outside each edge of the walkable field. */
const FOREST_MARGIN = 3;
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

  preload() {
    loadArt(this);
  }

  create() {
    this.drawGround();
    // The forest ring sits just outside the walkable field, so the camera may show it.
    const m = FOREST_MARGIN * TILE;
    this.cameras.main.setBounds(-m, -m, WORLD_WIDTH + m * 2, WORLD_HEIGHT + m * 2);
    // 2x zoom keeps characters and names readable on a phone in landscape.
    this.cameras.main.setZoom(2);
    this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    this.scene.launch("ui");
    void this.connect();
  }

  /** Grass field with small plants, ringed by forest just outside the walkable area. */
  private drawGround() {
    const M = FOREST_MARGIN;
    const cols = Math.ceil(WORLD_WIDTH / TILE) + M * 2;
    const rows = Math.ceil(WORLD_HEIGHT / TILE) + M * 2;
    const map = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: cols, height: rows });
    const tiles = map.addTilesetImage(SHEETS.rpg.key, SHEETS.rpg.key, TILE, TILE, 0, 1);
    if (!tiles) return;
    const ground = map.createBlankLayer("ground", tiles, -M * TILE, -M * TILE);
    if (!ground) return;
    // Fixed seed so every player sees the same field.
    const rnd = new Phaser.Math.RandomDataGenerator(["talesreach"]);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const roll = rnd.frac();
        ground.putTileAt(roll < 0.2 ? RPG.grassAlt : RPG.grass, x, y);
        const inField = x >= M && x < cols - M && y >= M && y < rows - M;
        if (inField && roll > 0.95) {
          const px = (x - M) * TILE + TILE / 2;
          const py = (y - M) * TILE + TILE / 2;
          this.add.image(px, py, SHEETS.rpg.key, rnd.pick([...RPG.decor])).setDepth(1);
        }
      }
    }
    // Forest ring: three staggered rows of trees outside each edge.
    for (let ring = 0; ring < M; ring++) {
      const off = ring * TILE + TILE / 2;
      for (let x = -M * TILE + (ring % 2) * 8; x < WORLD_WIDTH + M * TILE; x += TILE) {
        this.addTree(x + TILE / 2, -off + TILE / 2, rnd);
        this.addTree(x + TILE / 2, WORLD_HEIGHT + off + TILE * 1.5, rnd);
      }
      for (let y = -TILE / 2; y < WORLD_HEIGHT + TILE * 2; y += TILE) {
        this.addTree(-off, y + (ring % 2) * 8, rnd);
        this.addTree(WORLD_WIDTH + off, y + (ring % 2) * 8, rnd);
      }
    }
    for (let i = 0; i < 14; i++) {
      this.add
        .image(rnd.between(3, WORLD_WIDTH / TILE - 4) * TILE, rnd.between(3, WORLD_HEIGHT / TILE - 4) * TILE, SHEETS.rpg.key, RPG.bush)
        .setDepth(1);
    }
  }

  private addTree(x: number, baseY: number, rnd: Phaser.Math.RandomDataGenerator) {
    const pine = rnd.frac() < 0.5;
    this.add.image(x, baseY - TILE / 2, SHEETS.rpg.key, pine ? RPG.pineTrunk : RPG.treeTrunk).setDepth(baseY);
    this.add.image(x, baseY - TILE * 1.5, SHEETS.rpg.key, pine ? RPG.pineTop : RPG.treeTop).setDepth(baseY);
  }

  private async connect() {
    const say = (text: string) => {
      const el = document.getElementById("status");
      if (el) el.textContent = text;
    };
    say("The world is waking up…");
    try {
      const room = await joinWorld((secs) =>
        say(`The world is waking up… (${secs}s — the free server sleeps when nobody plays, this can take a minute)`),
      );
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
      a.shadow.destroy();
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
      // Face the way you're walking; draw lower characters in front.
      if (Math.abs(pos.x - a.body.x) > 0.05) a.body.setFlipX(pos.x < a.body.x);
      a.body.setPosition(pos.x, pos.y - 4).setDepth(pos.y);
      a.shadow.setPosition(pos.x, pos.y + 3).setDepth(pos.y - 1);
      a.label.setPosition(pos.x, pos.y - PLAYER_RADIUS - 6).setDepth(WORLD_HEIGHT + 1);
    }
  }

  private createAvatar(p: PlayerView, isMe: boolean): Avatar {
    const frame = READY_MADE_CHARACTERS[p.colour % READY_MADE_CHARACTERS.length] ?? READY_MADE_CHARACTERS[0];
    const body = this.add.sprite(p.x, p.y - 4, SHEETS.chars.key, frame);
    // A soft shadow; yours gets a light ring so you can find yourself.
    const shadow = this.add.ellipse(p.x, p.y + 3, 12, 5, isMe ? 0xfff3c4 : 0x000000, isMe ? 0.55 : 0.3);
    const label = this.add
      .text(p.x, p.y - PLAYER_RADIUS - 4, isMe ? `${p.name} (you)` : p.name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#f3e6c8",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(WORLD_HEIGHT + 1)
      .setResolution(4);
    return { body, shadow, label, interp: new Interpolator(100) };
  }
}
