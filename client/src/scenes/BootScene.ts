import Phaser from "phaser";
import { GAME_NAME } from "@talesreach/shared";
import { joinWorld } from "../net";

/** First scene: shows the title and connects to the world room. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create() {
    const { width, height } = this.scale;
    const title = this.add
      .text(width / 2, height / 2, GAME_NAME, { fontFamily: "serif", fontSize: "48px", color: "#f3e6c8" })
      .setOrigin(0.5);

    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      title.setPosition(size.width / 2, size.height / 2);
    });

    void this.connect();
  }

  private async connect() {
    const status = document.getElementById("status");
    const say = (text: string) => {
      if (status) status.textContent = text;
    };
    say("The world is waking up…");
    try {
      const room = await joinWorld();
      say("Connected to the world.");
      room.onMessage("pong", () => undefined);
      room.onMessage("rejected", () => undefined);
      room.onLeave(() => say("Disconnected."));
    } catch {
      say("Could not reach the world. Is the server running?");
    }
  }
}
