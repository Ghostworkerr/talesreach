import { Schema, type } from "@colyseus/schema";

/**
 * State the server shares with every client in the world room.
 * Placeholder for now — players and positions arrive in tasks 0.2/0.3.
 */
export class WorldState extends Schema {
  @type("uint16") playerCount = 0;
}
