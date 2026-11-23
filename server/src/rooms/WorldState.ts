import { MapSchema, Schema, type } from "@colyseus/schema";

/** A player as every client sees it. Positions are decided by the server only. */
export class PlayerState extends Schema {
  @type("string") name = "";
  @type("uint8") colour = 0;
  @type("float32") x = 0;
  @type("float32") y = 0;
}

/** State the server shares with every client in the world room. */
export class WorldState extends Schema {
  @type("uint16") playerCount = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
