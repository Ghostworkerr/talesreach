import Phaser from "phaser";
import { DPR, canvasSize } from "./display";
import { UIScene } from "./scenes/UIScene";
import { WorldScene } from "./scenes/WorldScene";

const size = canvasSize();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#1b1611",
  // Draw at the screen's real density, then show at CSS size: sharp on phones.
  scale: {
    mode: Phaser.Scale.NONE,
    width: size.width,
    height: size.height,
    zoom: 1 / DPR,
  },
  pixelArt: true,
  roundPixels: true,
  scene: [WorldScene, UIScene],
});

window.addEventListener("resize", () => {
  const s = canvasSize();
  game.scale.resize(s.width, s.height);
});

// Development only: lets automated checks drive the game. Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __talesreachGame: Phaser.Game }).__talesreachGame = game;
}
