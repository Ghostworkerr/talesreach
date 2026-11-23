import Phaser from "phaser";
import { MoveInput } from "../input";
import { audio, preloadSfx } from "../audio";

/**
 * Overlay scene with its own unzoomed camera for on-screen controls,
 * so the joystick sits exactly under the player's thumb whatever the world zoom.
 */
export class UIScene extends Phaser.Scene {
  moveInput!: MoveInput;

  constructor() {
    super("ui");
  }

  preload() {
    preloadSfx(this);
  }

  create() {
    // This scene lives for the whole game, so it hosts the audio manager.
    audio.attach(this);
    this.moveInput = new MoveInput(this);
  }
}
