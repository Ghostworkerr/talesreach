import Phaser from "phaser";
import { UIScene } from "./scenes/UIScene";
import { WorldScene } from "./scenes/WorldScene";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#1b1611",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  pixelArt: true,
  scene: [WorldScene, UIScene],
});

// Development only: lets automated checks drive the game. Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __talesreachGame: Phaser.Game }).__talesreachGame = game;
}
