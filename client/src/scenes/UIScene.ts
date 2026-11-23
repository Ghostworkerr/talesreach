import Phaser from "phaser";
import { MoveInput } from "../input";

/**
 * Overlay scene with its own unzoomed camera for on-screen controls,
 * so the joystick sits exactly under the player's thumb whatever the world zoom.
 */
export class UIScene extends Phaser.Scene {
  moveInput!: MoveInput;

  constructor() {
    super("ui");
  }

  create() {
    this.moveInput = new MoveInput(this);
  }
}
