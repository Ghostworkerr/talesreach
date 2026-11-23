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

/** An NPC as every client sees it (behaviour and schedules stay on the server). */
export class NpcState extends Schema {
  @type("string") name = "";
  @type("string") title = "";
  @type("uint16") frame = 0;
  @type("float32") x = 0;
  @type("float32") y = 0;
  /** What they're doing: working, serving, resting, performing, wandering, sleeping. */
  @type("string") activity = "";
}

/** State the server shares with every client in the world room. */
export class WorldState extends Schema {
  @type("uint16") playerCount = 0;
  /** Server clock (epoch ms), refreshed every second: everyone shares one world time. */
  @type("float64") serverMs = Date.now();
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: NpcState }) npcs = new MapSchema<NpcState>();
  /** The bard's current song (index into BARD_SONGS) and a counter that changes on each request. */
  @type("uint8") bardSong = 0;
  @type("uint16") bardSongSeq = 0;
}
