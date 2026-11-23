# Talesreach — Progress log

Read this first after any reset. It says what is done, what is in progress, and what is
next. Updated after every task.

## Owner instructions (standing, 2026-11-23)
- Work autonomously: do every task possible without asking for a go-ahead.
- Keep this file updated regularly.
- When the task list is done: do a full review and polish visuals, gameplay and everything.
- Study and build: character creation, an opening message/cutscene, and how quest
  cutscenes should look (see `docs/DESIGN_NOTES.md`).
- Every action gets an animation (also in `CLAUDE.md`).
- Phase gates (owner playtests) are recorded as **waiting for owner**; work continues
  past them on the owner's instruction.

## Live
- Game: https://talesreach.playtalesreach.workers.dev (Cloudflare Workers, auto-deploys from `main`)
- Server: https://talesreach-server.onrender.com (Render free, auto-deploys from `main`)
- Repo: https://github.com/Ghostworkerr/talesreach

## Status
| Task | Status | Notes |
|---|---|---|
| 0.1 Monorepo | done | |
| 0.2 Two tabs see each other | done | |
| 0.3 Server-authoritative movement | done | prediction, interpolation, abuse tests |
| 0.4 Art family | done | Kenney Roguelike series (CC0) |
| 0.5 Deploy | done | Workers + Render |
| Phase 0 gate | passed | owner confirmed phone + PC movement |
| Polish: sharp + smooth + walk animation | done | paper-doll walk cycle |
| 1.1 Music and sound | done | 6 CC0 tracks, 3 ambience loops, 24 Kenney effects; audio manager + settings panel |
| 1.2 Tavern map | done | Tiled map built by tools/maps/build-crossroads.mjs; server collision; tap-to-move |
| 1.3 Guest play + accounts | done | age gate (under-13 blocked, minors flagged), guest accounts, save codes; Drizzle + Postgres (in-memory until DATABASE_URL) |
| 1.4 Character creator | done | opening cutscene + creator (8 options, animated preview, random look/name), unique filtered names |
| 1.5 Chat + safety | done | local (in earshot) + party chat, bubbles, filters, mute/block/report, admin queue at /admin |
| 1.6 World clock + inn rooms | done | 2-hour days, seasons, lighting with flickering lights; coins, room rental, beds, chest; economy log |
| 1.7 NPCs | done | Marta (innkeeper), Tobin (server), Lark (bard): daily routines, walking, dialogue, song tips |
| 1.8 Homepage + PWA | next | |
| Phase 1 gate | waiting for owner | 10 friends, 30 min, phones + PCs |

## Waiting for the owner
- **Database (so saves survive server restarts):** create a free Neon Postgres database and put its
  connection string into Render as the `DATABASE_URL` environment variable (step-by-step instructions
  are given in the chat when asked). Until then accounts live in memory; devices quietly re-register.
- **Moderation page:** set a long random `ADMIN_TOKEN` (24+ characters) in Render's environment
  variables; then open https://talesreach-server.onrender.com/admin and enter it to see player reports.
- **Email login (optional, later):** needs an email-sending service account (e.g. Resend). Save codes
  work without it.
- Phase 1 gate playtest (after 1.8).

## Log
- 2026-11-23: Phase 0 complete; walk animation reworked after owner feedback — owner confirmed it works.
- 2026-11-23: Design study written (docs/DESIGN_NOTES.md): first-visit flow, opening scene, creator, cutscene system.
- 2026-11-23: 1.1 done — music by mood with crossfades, ambience layers, footsteps, gear-button settings panel (music/ambience/effects/mute, saved per device). Audio total 5.5 MB, loaded on demand.
- 2026-11-23: 1.2 done — Crossroads Inn + courtyard Tiled map (bar, hearth, tables, bard corner, 2 rentable rooms, crossroads outside). Server uses the same map for walls; tap/click-to-move with A* routes and a marker; music/ambience/footsteps change between inn and courtyard. 35 tests.
- 2026-11-23: Repo now stores Unix line endings (.gitattributes).
- 2026-11-23: 1.3 done — neutral date-of-birth screen before any account; under-13 refused (and remembered for a day on that device); 13–17 flagged minor; guest accounts with device tokens (hashed); save codes to play on other devices (rate-limited); one character per account at a time; silent re-registration if the server forgets. 46 tests.
- 2026-11-23: 1.4 done — first visit: date of birth → opening cutscene (letterboxed glide from the crossroads into the inn, skippable) → character creator (skin, build, hair, colour, beard, headwear, outfit, legs; animated walking preview; random look/name) → world. Everyone sees each other's look. Names 3–16 letters, unique, filtered (whole-word list avoids Scunthorpe-style false blocks). Reusable cutscene system (narration, dialogue, camera pans). 55 tests.
- 2026-11-23: 1.5 done — local chat reaches players within ~14 tiles, party chat (parties of up to 5 with invites); swearing masked and links removed for everyone; phone numbers/emails/social handles removed in anything sent by or shown to a minor; spam + flood limits; mute (device), block (server, saved, both ways), report (server-captured chat evidence, rate-limited) → admin queue (/admin, needs ADMIN_TOKEN). Speech bubbles, chat log, player menu on tap, invite toasts, party list. 66 tests.
- 2026-11-23: Fix — Render had stopped deploying since 1.3: the in-memory Postgres (PGlite) made the server use ~470–510 MB at start-up, at the free plan's 512 MB limit. Without a DATABASE_URL the server now uses a light in-memory account store (~220 MB total); PGlite is only used in tests to check the SQL. A shared contract test runs against both stores. 74 tests.
- 2026-11-23: Verified live after the fix: under-13 refused, guest + profile + join work, join without token refused, chat filtered.
- 2026-11-23: 1.6 done — server world clock (2 real-hour days, weekly seasons, fixed start date so restarts don't reset it); dusk/night lighting with flickering torches, candles and hearth, your own small glow; night music outdoors; HUD clock + coins. Economy: 20 starting coins, innkeeper rents rooms (5 coins per world day, extends), rest in your bed to wake there, room chest for coins; every coin change in a locked transaction + append-only economy log; double-spend test on both stores. 87 tests.
- 2026-11-23: 1.7 done — server-run NPCs with daily routines by world hour (Marta tends the bar / rests by the hearth; Tobin serves tables / rests; Lark wanders the courtyard by day, performs every evening, sleeps late), walking with the walk cycle on collision-checked routes; dialogue by time of day, activity and how often you've chatted; rumours; tip the bard 1 coin to change the inn's song for everyone (logged). Music notes and zzz effects. 94 tests.
