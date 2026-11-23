import { MapSchema, Schema, type } from "@colyseus/schema";

/** A player as every client sees it. Positions are decided by the server only. */
export class PlayerState extends Schema {
  @type("string") name = "";
  /** Public player id (for mute/block/report/invite). Not the account id. */
  @type("string") pid = "";
  @type("uint8") colour = 0;
  /** Appearance choices (see shared/appearance.ts); everyone sees your look. */
  @type("uint8") body = 0;
  @type("uint8") legs = 0;
  @type("uint8") outfit = 0;
  @type("uint8") hairStyle = 0;
  @type("uint8") hairColour = 0;
  @type("uint8") beard = 0;
  @type("uint8") hat = 0;
  @type("float32") x = 0;
  @type("float32") y = 0;
  /** Last input sequence number the server applied (lets the owner's client reconcile). */
  @type("uint32") ack = 0;
}

/** State the server shares with every client in the world room. */
export class WorldState extends Schema {
  @type("uint16") playerCount = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
