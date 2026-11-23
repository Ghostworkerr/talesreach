import Phaser from "phaser";
import { DPR, canvasSize } from "./display";
import "./ui/ui.css";
import { mountSettings } from "./ui/settings";
import { audio } from "./audio";
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
  // The game lives at /play/; art, sound and maps are served from the site root.
  loader: { baseURL: "/" },
  scene: [WorldScene, UIScene],
});

const uiRoot = document.getElementById("ui");
if (uiRoot) mountSettings(uiRoot);

window.addEventListener("resize", () => {
  const s = canvasSize();
  game.scale.resize(s.width, s.height);
});

// Installable app + faster repeat visits (production only; the dev server reloads too often for caching).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

// Development only: lets automated checks drive the game. Stripped from production builds.
if (import.meta.env.DEV) {
  Object.assign(window as object, { __talesreachGame: game, __talesreachAudio: audio });
}
