# Talesreach — rules for Claude Code

Talesreach is a free browser MMORPG (phone + PC) set in a medieval fantasy world where
players live a life: adventure, farm, craft, trade, work, marry, raise a family, become
a bandit, a guard or a king. The owner is not a programmer and wants you to do the work.
Explain what you did in plain language, and only ask them for things you truly cannot do
(account sign-ups, testing on their phone, decisions).

Read these before any task:
- `docs/GAME_SPEC.md` — what the game is and how every system works
- `docs/TASKS.md` — the ordered task list; do the next unchecked task only

## How to work
1. Do one task from `docs/TASKS.md` at a time. Plan it, build it, test it, then tick it off.
2. Order inside a task: shared rules → server → client → tests.
3. Run all tests before saying a task is done. Never say "done" if tests fail.
4. Commit after each finished task with a clear message.
5. Finish every task with: what changed, how the owner can try it on their phone
   (a link or one simple step), and what the next task is.
6. Never start the next phase until the current phase's gate (in TASKS.md) passes.

## Security rules (never break these)
- The client sends **intentions** ("move left", "use skill 2 on target 41", "buy item 7").
  The server decides **results** (positions, damage, loot, coins, items). Never trust a
  position, amount, item or player ID sent by the client.
- Every client→server message has a Zod schema in `shared/`. Reject anything invalid,
  oversized or too frequent (rate-limit per connection).
- Every new message type gets an **abuse-case test**: a fake client sends a bad or
  cheating message and the test asserts the server refuses it.
- Items have unique IDs. Trades, drops, crafting, shop and market actions run inside one
  database transaction with row locks. No duplication is possible.
- Every coin and item change is written to an append-only economy log.
- Interest management: send each client only what is within its view range.
- Secrets, drop tables and spawn tables live only on the server.
- No real-money trading of coins or items. Real-money purchases are cosmetic or
  convenience only and never tradeable.

## Player safety rules
- Sign-up asks for date of birth. Under-13: not allowed. Under-18: minor account.
- Player-to-player marriage and proposals: only when **both** accounts are 18+.
- Chat filter on by default. Block phone numbers, social handles and links for minor
  accounts and in any private message between an adult and a minor.
- Every player can mute, block and report. Reports go to an admin queue.
- No sexual content anywhere. Relationships are wholesome (weddings, homes, family).

## Tech stack
- Monorepo: `shared/` (TypeScript rules + schemas), `server/` (Node.js + Colyseus),
  `client/` (Phaser 4 + TypeScript + Vite, HTML/CSS overlay for UI), `web/` (homepage,
  Herald, Most Wanted as real HTML), `assets/`, `tests/`, `docs/`.
- PostgreSQL (Neon or Supabase free tier) via Drizzle or Prisma.
- Maps made in Tiled (.tmj); the server uses the same map for collision.
- Hosting: client on Cloudflare Pages (talesreach.pages.dev); server on Render free tier
  (show a "The world is waking up…" screen while it spins up). Keep a Dockerfile so the
  server can move to any host.

## Mobile first
- Design for a phone in landscape. 60 fps target on a mid-range Android.
- Virtual joystick + tap-to-move, big buttons, no hover-only UI.
- First download under 15 MB; load assets per zone. Low-data mode and a
  Low/Medium/High quality setting.
- Audio starts on the first tap (phones block it before then).

## Assets: art, music and sound — you find them
The owner cannot make art or music. You source everything. Rules:
- Only use assets whose licence allows **commercial use in a web game**:
  CC0 / public domain (preferred), or CC-BY (allowed with credit).
  **Never** use CC-BY-NC, CC-BY-ND, "personal use only", unclear or missing licences,
  ripped game assets, or anything copying the reference screenshots.
- Good sources: Kenney (kenney.nl, all CC0), OpenGameArt.org (filter CC0/CC-BY),
  itch.io free asset packs whose page states commercial use is allowed,
  Freesound.org (CC0 filter) for sound effects, and CC0/CC-BY music from OpenGameArt.
- Pick **one** art family for tiles, characters and UI so the world looks consistent.
  Use that pack's tile size (16×16 or 32×32) everywhere. Write the choice, palette and
  rules in `docs/STYLE.md`.
- Record every asset in `assets/CREDITS.md`: name, author, source URL, licence, and
  which files came from it. Show CC-BY credits on an in-game Credits screen.
- If your environment cannot download from a site, do not stop and do not ask the owner
  to search. Give the owner a short list of exact download links (one per line) and say
  where to put each file, or pick an alternative source you can reach (for example a
  CC0 pack mirrored on GitHub).
- Small placeholder art you draw in code (coloured shapes) is fine until real assets arrive.

## Game rules summary (full detail in docs/GAME_SPEC.md)
- Skill-based progression (~25 skills, 1–100, raised by use, total cap). No classes.
- Real-time action combat; stamina drives attacks, dodges and blocks; telegraphed enemy attacks.
- Day/night cycle of 2 real hours; seasons change every real week; server-owned weather.
- Survival: hunger, thirst, stamina, warmth; needs pause while logged out.
- Open world streamed in chunks; interiors are instances behind a short fade.
- Reputation per town/faction, crime and bounties, bandit life with real penalties.
- Farming, crafting, NPC jobs, inns, housing, marriage (NPC or 18+ players), adoption, legacy.
- Economy with sinks (repairs, rent, upkeep, sales tax ~5–10%).
