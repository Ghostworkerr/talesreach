import { ROOM_PRICE, SONG_PRICE, BARD_SONGS, type WorldTime } from "@talesreach/shared";
import type { Routine } from "./npcs.js";

/**
 * Simple, hand-written dialogue for the inn staff. Lines depend on the time of
 * day, what the NPC is doing, and how many times you've chatted this visit.
 * (NPC memory of big events arrives in task 2.10.)
 */
export interface DialogOption {
  id: string;
  label: string;
}
export interface Dialog {
  speaker: string;
  point: string;
  text: string;
  options: DialogOption[];
}

export interface TalkContext {
  playerName: string;
  time: WorldTime;
  activity: Routine["activity"];
  /** How many times this player has talked to this NPC since joining (0 = first time). */
  talks: number;
  /** Is the player's inn room rented right now? */
  rented: boolean;
}

const pick = <T>(list: readonly T[], n: number): T => list[n % list.length]!;

const RUMOURS = [
  "They say wolves have been seen near the forest road after dark. Keep to the lanterns.",
  "A merchant swore he saw a great white stag in the old grove. Spirit or beast, who knows?",
  "Goblins have been nicking scrap from the farms to the east. Bold little things.",
  "The farmers want help with rats in the fields. Pays in bread, mostly.",
  "Someone left a sack of coins under table three last week. Wasn't me who found it, sadly.",
  "Lark plays every evening. Tip a coin and she'll play your favourite.",
];

export function innkeeperDialog(name: string, ctx: TalkContext): Dialog {
  const late = ctx.activity === "resting";
  const hello = ctx.talks === 0 ? (ctx.playerName ? `Welcome to the Crossroads, ${ctx.playerName}!` : "Welcome to the Crossroads, traveller!") : pick(["Back again? Good.", "What can I do for you?", "Need anything, love?"], ctx.talks);
  const staff = ctx.talks % 3 === 1 ? " That's Tobin waiting tables, and Lark sings for us every evening." : "";
  const text = late
    ? `*yawns* ${hello} It's late, but a room's a room. ${ROOM_PRICE} coins a night.`
    : ctx.rented
      ? `${hello} Your room's ready whenever you need it — another night is ${ROOM_PRICE} coins if you'd like to stay longer.`
      : `${hello} A warm bed, a chest for your coins, and you'll wake here safe and sound. ${ROOM_PRICE} coins a night.`;
  const said = `${text}${staff}`;
  return {
    speaker: `${name} the Innkeeper`,
    point: "innkeeper",
    text: said,
    options: [
      { id: "rentRoom", label: ctx.rented ? `Stay another night (${ROOM_PRICE} coins)` : `Rent a room (${ROOM_PRICE} coins)` },
      { id: "bye", label: "Maybe later" },
    ],
  };
}

export function serverDialog(name: string, ctx: TalkContext): Dialog {
  if (ctx.activity === "resting") {
    return {
      speaker: `${name} the Server`,
      point: "server",
      text: pick(["Kitchen's closed, friend. Feet are killing me.", "Off duty! Ask me again when the sun's up.", "Mmh? Oh — good night to you too."], ctx.talks),
      options: [{ id: "bye", label: "Sleep well" }],
    };
  }
  const opener = ctx.talks === 0 ? `Hi! I'm ${name}. Anything you need, just wave.` : pick(["Busy night!", "Back for more gossip?", "Careful, that table wobbles."], ctx.talks);
  return {
    speaker: `${name} the Server`,
    point: "server",
    text: `${opener} ${pick(RUMOURS, ctx.talks + ctx.time.day)}`,
    options: [
      { id: "say:server", label: "Heard anything else?" },
      { id: "bye", label: "Thanks!" },
    ],
  };
}

export function bardDialog(name: string, ctx: TalkContext): Dialog {
  if (ctx.activity === "sleeping") {
    return { speaker: `${name} the Bard`, point: "bard", text: "Zzz… *mumbles a melody in her sleep*", options: [{ id: "bye", label: "Tiptoe away" }] };
  }
  if (ctx.activity === "performing") {
    return {
      speaker: `${name} the Bard`,
      point: "bard",
      text: ctx.talks === 0 ? `A listener! I'm ${name}. Toss a coin and I'll play whatever your heart desires.` : "Another request? I do love an audience.",
      options: [
        ...BARD_SONGS.map((s, i) => ({ id: `song:${i}`, label: `“${s}” (${SONG_PRICE} coin)` })),
        { id: "bye", label: "Just listening" },
      ],
    };
  }
  return {
    speaker: `${name} the Bard`,
    point: "bard",
    text: pick(
      [
        "Practising a new ballad about a troll and a teapot. Don't ask.",
        "Come to the inn this evening — I play every night from dusk.",
        "The crossroads are the best place to hear the world go by.",
      ],
      ctx.talks,
    ),
    options: [{ id: "bye", label: "See you tonight" }],
  };
}
