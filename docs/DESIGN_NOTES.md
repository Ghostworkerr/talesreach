# Talesreach — Design notes: first minutes, character creation, cutscenes

Study of what the first minutes need (GAME_SPEC §1–2, §10, §12, §16) and how other
successful browser/mobile RPGs handle the same moments, turned into concrete rules.

## What the spec asks for
- **Guest play in under 10 seconds** (§16). Anything before the first step in the world
  must be skippable or very short.
- **"You log in and you're someone"** (§1): a name, a face, a place (the Crossroads Inn).
- **Start:** a traveller at the Crossroads Inn with a few coins; the first hour teaches
  moving, a fight, a cooking fire, a farm task and a tavern talk, then lets go (§2).
- Story quests per region, NPC life quests, board jobs (§12) — they need a way to tell a
  story without long videos (phones, data, 15 MB budget).

## Lessons from comparable games (patterns, not copies)
- Browser/mobile players leave within the first minute if they hit a long form or a
  loading wall. Successful web MMOs let you **play first, customise in under a minute,
  and sign up later**.
- **Character creators that work on phones** show the character big in the middle,
  with a few large category tabs (Body, Hair, Clothes, Colours) and left/right arrows per
  option, plus a **Random** button. Every change previews instantly. Name is the last
  step, with a random-name button.
- **Openings that work in small games** are short "moving storybook" scenes: 3–5 panels of
  text over the real game world, the camera gliding, a tap to advance, a visible **Skip**.
  They set the tone and the goal, then hand over control fast.
- **Quest cutscenes in pixel-art RPGs** use the game engine itself, not video: letterbox
  bars slide in, input pauses, the camera pans to the speaker, characters walk and emote,
  dialogue appears in a framed box with the speaker's portrait/name, a tap advances.
  Cheap, fits any screen, works offline, and is easy to write as data.

## Decisions for Talesreach
### Flow on first visit
1. **Title screen** (2–3 s max): logo over the live world behind it, "Play" button.
   No sign-up wall.
2. **Opening scene** (~20 s, skippable): letterboxed, the camera drifts along the road
   to the Crossroads Inn at dusk. Narration panels:
   1. "The roads of the realm all meet at one place."
   2. "The Crossroads Inn — warm fire, cold ale, and more stories than tables."
   3. "You arrive with a few coins, worn boots, and no name anyone knows… yet."
   4. "Who are you?" → opens the creator.
3. **Character creator** (under 60 s): live preview, tabs Body / Hair / Outfit /
   Colours, arrows, Random, name with random-name suggestions. Confirm → fade into the inn.
4. **First steps**: the innkeeper greets you by name (dialogue box), points at the
   notice board and the door. Later tasks add the tutorial beats (fight, fire, farm, talk).
5. Returning players skip straight to the world (choices remembered).

### Cutscene system (one system for opening, quests and events)
- Written as **data** (a list of steps), so quests can add scenes without new code:
  `letterbox on/off`, `camera pan to`, `wait`, `narrate text`, `say (speaker, text)`,
  `walk npc to`, `emote`, `fade in/out`, `play sound/music`.
- **Look:** black letterbox bars (12% of screen height each) slide in; dialogue box uses
  the UI pack's parchment panel at the bottom, speaker name in a brown tab, text types out
  (tap to finish, tap again to advance); a small **Skip** at top-right; narration text is
  centred over a dark gradient without a box.
- **Rules:** never longer than ~30 s without player input; always skippable; never kills
  or costs the player anything; server-driven state is not paused for others (cutscenes
  are personal, the world keeps moving); other players see you with a "…" bubble.
- **Animation rule applies:** speakers bob when talking, characters walk (never slide),
  emotes animate.

### Character creator details (task 1.4)
- Paper-doll layers from Roguelike Characters: body (skin tone ×4), legs, shirt/armour,
  hair (style × colour), beard (optional), hat (optional, later).
- The server stores only **choice indexes**, validated against allowed ranges (Zod);
  the client never sends art paths. Names: 3–16 letters/spaces, filtered for profanity and
  contact info, unique per world.
- Everyone sees your appearance (state sync), so the creator also fixes "everyone looks
  the same".
