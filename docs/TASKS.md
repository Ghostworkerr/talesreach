# Talesreach — Task list for Claude Code

How to use: the owner opens Claude Code on this repo and says **"Do the next task."**
Claude Code does the first unticked task, ticks it, commits, and reports back in plain
language with how to test it on a phone. Follow CLAUDE.md for every task.

Things only the owner can do are marked **[OWNER]**. Ask for them only when that task is
reached, with simple step-by-step instructions written for a non-programmer on a phone.

---

## Phase 0 — Foundations
- [x] 0.1 Set up the monorepo: `shared/`, `server/` (Node + Colyseus), `client/` (Phaser 4 +
      Vite + TypeScript), `web/`, `tests/`, lint + test scripts, Dockerfile for the server.
- [ ] 0.2 Two browser tabs see each other's placeholder character move in one room.
- [ ] 0.3 Server-authoritative movement with client prediction and smoothing. Abuse tests:
      fake teleport, speed hack and oversized/garbage messages are all rejected.
- [ ] 0.4 Find and choose the art family (see CLAUDE.md asset rules): one CC0/CC-BY pack
      (prefer Kenney or a single itch.io/OpenGameArt family) covering medieval town, forest,
      characters and UI. Write `docs/STYLE.md` and `assets/CREDITS.md`. Import a first set.
- [ ] 0.5 Deploy for testing: client to Cloudflare Pages, server reachable for testing.
      **[OWNER]** create free Cloudflare and Render accounts and connect this GitHub repo
      when asked (give exact taps/clicks).
- **Gate:** owner opens the link on their phone and a PC at the same time and both
  characters move together; teleport test passes.

## Phase 1 — The living tavern
- [ ] 1.1 Find and import music and sound (CC0/CC-BY): tavern theme, overworld day/night,
      combat, UI clicks, coins, footsteps, fire, rain. Credit them. Build an audio manager
      with music/ambience/effects sliders and phone audio unlock.
- [ ] 1.2 Tavern (Crossroads Inn) map in Tiled using the chosen pack; same map used for
      server collision. Virtual joystick + tap-to-move; WASD on PC.
- [ ] 1.3 Guest play + account save (email magic link or managed auth). Date of birth at
      sign-up; under-13 blocked; minor flag stored.
- [ ] 1.4 Character creator (body, hair, colours, outfit from the pack).
- [ ] 1.5 Local + party chat, profanity filter, contact-info filter for minors, mute,
      block, report → admin queue. Abuse tests.
- [ ] 1.6 Server world clock: day/night (2 real hours) with lighting; inn rooms to rent
      (safe logout, storage chest, respawn).
- [ ] 1.7 NPCs with schedules (innkeeper, server, bard) and simple dialogue.
- [ ] 1.8 Homepage on `web/` with real text ("Talesreach — free browser MMORPG, no download"),
      rules page, privacy policy, credits page. PWA install.
- **Gate:** 10 friends hang out 30 minutes on phones and PCs without bugs.

## Phase 2 — The adventure (public alpha)
- [ ] 2.1 Chunk-streamed open world: town + forest + farmland + marsh edge; interiors as
      instances with short fade.
- [ ] 2.2 Weather system (server-owned) with rain/fog/storm visuals, sounds and gameplay effects.
- [ ] 2.3 Combat core: stamina, attack combos, dodge, block/parry, telegraphs, damage types,
      status effects, downed/revive, death rules by zone. Abuse tests for every combat message.
- [ ] 2.4 Weapons: sword+shield, bow, staff with skills unlocked by use.
- [ ] 2.5 Skill system (use-based, cap, milestones, titles) for combat + survival skills.
- [ ] 2.6 Monsters from GAME_SPEC §5 with behaviours, spawns, drops; the Hollow Stag mini-boss.
- [ ] 2.7 Inventory, equipment, durability, repairs; items with unique IDs; economy log.
- [ ] 2.8 Survival: hunger, thirst, warmth, campfire cooking, camping.
- [ ] 2.9 Gathering + basic crafting (cooking, smithing) and one vendor NPC.
- [ ] 2.10 Quest board with generated jobs + 5 hand-written quests; NPC memory v1;
      NPC bounty board.
- [ ] 2.11 Rented farm plot with 4 crops, watering, seasons.
- [ ] 2.12 Low-data mode, quality setting, "world is waking up" screen, load test with
      50 bot players, fresh security review session.
- **Gate:** 10 people play an hour on mixed devices, nobody can teleport or dupe, half want
  to return. Then public launch on talesreach.pages.dev and an itch.io page.

## Phase 3 — The society
- [ ] 3.1 Player trading + market with listing fee and sales tax; orders board.
- [ ] 3.2 All professions and crafting chains from GAME_SPEC §8; quality tiers; NPC jobs.
- [ ] 3.3 Reputation per town/faction; Fame/Infamy; titles shown above names.
- [ ] 3.4 Crime, Wanted levels, guards, fines/jail/pardon; PvP lawless zones; player
      bounties; bandit life + Thieves' Den with anti-grief rules.
- [ ] 3.5 Guilds + guild chat.
- [ ] 3.6 Housing (inn room decoration → instanced wards, furniture, permissions, upkeep).
- [ ] 3.7 Friendship + NPC courtship + weddings + NPC spouse; player marriage (18+ only);
      adoption; family name and crest. Safety tests for every age rule.
- [ ] 3.8 The Herald + Most Wanted public pages; Discord bot.
- [ ] 3.9 Cosmetic shop + supporter pass via Xsolla. **[OWNER]** sign up with Xsolla
      (and optionally Paystack) and add payout details when asked.
- **Gate:** two weeks with zero dupes in the economy log; 100 players online at once.

## Phase 4 — Kingdoms
- [ ] 4.1 Titles, territories, offices with real powers (taxes, laws, appointments).
- [ ] 4.2 NPC officials for empty seats; succession by election, rebellion or conquest.
- [ ] 4.3 Player-owned inns and shops; kingdom treasuries; wars between kingdoms.
- [ ] 4.4 Legacy system (play as heir) and dynasties.
- **Gate:** 200+ weekly active players.

## Phase 5 — The living world
- [ ] 5.1 New regions (mountains, coast, ruins) and their monsters; dragon world boss.
- [ ] 5.2 Seasonal festivals and rare world events calendar.
- [ ] 5.3 Translations; more server regions; CrazyGames version with opt-in rewarded ads.
- [ ] 5.4 Opt-in party voice chat (adults only) with moderation tools.
