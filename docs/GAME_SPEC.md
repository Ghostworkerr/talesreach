# Talesreach — Game Spec

Free browser MMORPG for phone and PC. Medieval fantasy. Players don't just level up —
they live a life. Full plan with sources: the "Talesreach — Build Plan" doc (Plan and
Game design tabs). This file is the working summary for building.

## 1. The feeling
You log in and you're *someone*. The baker knows your name, your field needs watering,
your spouse left a note, there's a bounty on the bandit who robbed you, and rain is coming.
Every way of living — fighting, farming, crafting, trading, working, ruling, outlawry —
is a real way to play and progresses as well as combat does.

## 2. Paths (no classes; paths overlap)
| Path | Do | Earn | Leads to |
|---|---|---|---|
| Adventurer | hunts, dungeons, escorts, exploring | loot, quests, bounties | guild rank, titles, monuments |
| Farmer | crops, orchards, livestock, bees | selling produce | estate, supplying cities |
| Crafter | smithing, tailoring, carpentry, alchemy, cooking, brewing | selling goods | master title, named workshop |
| Merchant | buy low, haul between towns, stalls | margins, caravan contracts | shops, trading house, inn owner |
| Worker | NPC part-time jobs | wages | promotions, buying into businesses |
| Guard / bounty hunter | patrols, arrests | wages, bounties | captain, knight, commander |
| Bandit | robbing caravans, ambushes, smuggling (lawless zones) | fenced loot | infamy, gang, hideout |
| Noble / ruler | land, taxes, laws, diplomacy | taxes | lord, duke, king/queen (Phase 4) |

Start: a traveller at the Crossroads Inn with a few coins. First hour teaches moving,
a fight, a cooking fire, a farm task and a tavern talk, then lets the player go.

## 3. World, time, weather
- One world clock owned by the server. Day/night = 2 real hours. Seasons change every real
  week (a year ≈ a real month).
- Weather per region rolled every 15–30 min: clear, cloudy, rain, storm, fog, snow
  (mountains). Weather affects play: rain waters crops and weakens fire, fog shortens sight,
  storms stop caravans, night spawns different monsters and makes stealing easier.
- Open world streamed in chunks (e.g. 64×64 tiles). Each region (a kingdom + its wilds) is
  one server room; borders at chokepoints (bridges, passes, gates). Interiors (houses, inns,
  dungeons) are instances behind a sub-second fade.
- Drawing: tint + darkness layer with light sources; rain/snow particles tied to the camera;
  fog layers; lightning flash + delayed thunder; quality setting Low/Medium/High.

## 4. Combat
- Real-time action. Phone: left joystick, big attack button (hold = combo), dodge, block
  (tap = parry), 4 skill buttons, 1 item slot, auto-target nearest / tap to lock.
  PC: WASD, left click, Space, right click, 1–4, Q, mouse aim.
- Stamina powers attacks, dodges, blocks, sprint. Hunger and cold lower max stamina.
- Every strong enemy attack is telegraphed (wind-up + red ground marker).
- Weapon defines moveset: sword+shield, two-hander, spear, daggers, bow, crossbow, staff, wand.
- Damage types: slash, pierce, blunt, fire, frost, lightning, holy, poison.
- Status: bleed, burn, chill, stun, poison, weakened (short, capped stacks).
- Parties up to 5. No forced tank/healer, but taunt and healing exist.
- Death: downed for 30 s (friends can revive), then wake at bed/inn/camp. Loss by zone:
  safe = durability only; dangerous/PvP = part of carried goods, never equipped gear.
- PvP only in lawless zones, declared wars, arena duels, and vs criminals. Attacking an
  innocent inside the law = instant criminal.

## 5. Monsters (first region)
Behaviours: grazers, pack hunters, ambushers, brutes, casters, night-only, weather-bound,
nests/camps that grow and raid farms if not cleared.
| Monster | Where | Behaviour | Danger 1–5 | Weakness | Drops |
|---|---|---|---|---|---|
| Field rat | farmland | swarms crops at night | 1 | any | hide scraps |
| Wild boar | forest edge | grazer, charges when hurt | 1 | pierce | meat, tusk, leather |
| Grey wolf | forest | pack hunter | 2 | fire | pelt, fang |
| Goblin scout | forest roads | ambusher, traps | 2 | blunt | coins, scrap metal |
| Goblin shaman | goblin camps | caster, heals | 3 | interrupt | herbs, totem |
| Bog lurker | marsh | ambusher, poison | 3 | fire | venom sac, moss |
| Forest troll | deep forest | brute, regenerates | 4 | fire stops regen | troll hide, rare club |
| Ghoul | graveyard (night) | swarm | 3 | holy, fire | bone dust, grave rings |
| Bandit (NPC) | roads, hideouts | mixed gang | 2–4 | varies | stolen goods |
| The Hollow Stag (mini-boss) | ancient grove | spirit beast, moon phases | 5 | silver | spirit antler |
Later: harpies, rock golems, frost giants, crabs, sea serpents, smugglers, skeletons,
cultists, a dragon world boss. Every monster: clear telegraphs, a counter-play, drops that
feed crafting, server-tunable spawn rate.

## 6. Skills and progression
~25 skills, each 1–100, raised by use; gains slow at higher levels; total cap (e.g. 1,200)
forces specialisation; unused skills can be lowered. Milestones at 25/50/75/100 unlock moves,
recipes, crops, dialogue, titles (e.g. Journeyman Smith, Master Brewer).
- Combat: Swords, Axes & Maces, Spears, Daggers, Bows, Shields, Unarmed, Heavy Armour, Light Armour
- Magic: Fire, Frost, Storm, Restoration, Warding
- Survival: Foraging, Hunting, Fishing, Cooking, Camping, Riding
- Craft: Smithing, Tailoring, Carpentry, Alchemy, Brewing
- Land: Farming, Animal Husbandry
- Social: Trading, Persuasion, Stealth & Lockpicking, Leadership
Gear gives small steps; skill beats gear. Titles and Fame/Infamy from deeds, shown above names.

## 7. Survival
Hunger, thirst, stamina, warmth. Fed = buff; starving slows but never kills. Cold from night,
rain, snow; warmth from campfires, cloaks, inns, homes. Gathering (wood, stone, herbs, fish,
game), cooking at fires, camping (tent + fire = temporary respawn), gear durability.
Needs and crops pause while logged out.

## 8. Farming, crafting, jobs
- Rent a plot, later own land with a house. Crops: wheat, barley, potatoes, cabbages, carrots,
  hops, grapes, herbs, flax, orchard trees. Seasonal crops; winter = greenhouses/livestock.
  Water (rain helps), weed, protect from rats, crows, bandits.
- Livestock: chickens, cows, sheep, pigs, horses (mounts), bees.
- Chains: wheat→flour→bread; barley+hops→ale; grapes→wine; flax→cloth.
- Recipes need inputs from at least two other lives. Quality: Crude, Common, Fine,
  Masterwork (signed by crafter). Free town workstations; better ones at home/guild.
- Orders board: players post wanted items + price; crafters fill them even offline.
- NPC jobs with mini-games: inn server, dockhand, stablehand, miner, scribe. Wages,
  reputation, skill gain, promotions.

## 9. Reputation, law, crime
- Standing per town, faction and key NPC: Hated, Distrusted, Neutral, Liked, Honoured.
  Plus a public Fame/Infamy score.
- Factions: each kingdom, Adventurers' Guild, Merchants' League, Farmers' Commons, Church,
  Thieves' Den (hidden until infamous).
- Crimes only where allowed: pickpocketing NPCs, stealing from unlocked stalls, robbing
  caravans, attacking players outside safe towns. Witnessed crime → Wanted level, guards,
  bounty on the board and public Most Wanted page. Clear by fine, jail (short prison job),
  pardon, or leaving the kingdom.
- Bandits: hideouts, fences (discount), contracts. Criminals: attackable by anyone, no banks
  or safe beds, drop more on death. Anti-grief: rob a share not all, new players protected
  for first hours, repeat kills of same player spike infamy and patrols. Pardons allow
  redemption.
- NPC memory: records big events (saved, robbed, betrayed) with importance; minor ones fade.
  Dialogue chosen from memory, not live AI.

## 10. Relationships, marriage, family
- ~20 marriageable NPCs with jobs, schedules, likes, personal quest stories. Friendship via
  talk, gifts, help, events. Court at high friendship; propose once you own a home.
- Wedding at the chapel with guests + tavern feast + shared title. NPC spouse moves in,
  has a routine, helps farm/shop, leaves notes and gifts, remembers adventures.
- Player marriage: **both accounts 18+ only**; must be friends 7+ days. Shared house,
  chest, family name, small buff when near each other. Either can divorce; house goes to
  buyer, shared storage split evenly. Same-gender marriage allowed.
- Minor accounts: sworn-sibling and best-friend bonds instead.
- Adoption from the orphanage (no pregnancy). Children grow over a few real weeks and help.
- Family name + crest, heirloom chest. Legacy: retire a character and continue as their
  grown child, inheriting home, name, part of wealth and reputation; noble titles pass down.
- Safety: block proposals/gifts/trades per player; report hides instantly; contact-info
  filters for minors; seeking real-life dating or sexual talk = ban.

## 11. Inns and housing
- Every town has an inn: rent a room per night for safe logout, storage, respawn, rested
  bonus. Innkeeper memory, rumour board, local bounties, tavern games (dice, cards,
  arm-wrestling, bard stage — in-game coins only).
- Housing stage 1: decorate your inn room. Stage 2: buy a house in an instanced residential
  ward. Crafted furniture, storage, crafting stations, trophy wall, friend/guild permissions,
  weekly upkeep tax to the kingdom. Guild halls later. Players can own and run inns later.

## 12. Quests and events
- Story quests (one chain per region), NPC life quests, generated board jobs that follow
  world state (camps grow → hunts; bread scarce → deliveries), player contracts and bounties.
- Weekly: Saturday town raid, market day, tavern contest night.
- Seasonal festivals: planting fair, summer tournament, harvest festival, winter feast.
- Rare: dragon sighting, rat plague, comet day, royal wedding.
- The Herald: auto-written world news page (first clears, big bounties, crownings).
- Monument of firsts in the town square.

## 13. Economy
One coin currency. Faucets: monster coins, NPC bounties, wages, NPC market sales (daily caps),
quest rewards, gathering. Sinks: repairs, rent, upkeep, land tax, market listing fee +
sales tax (start 5–10%), fast travel fees, consumables, death loss in danger zones, failed
crafts, dyes, festival fees, fines. NPC shops sell basics only. NPC buy prices fall with
supply. Weekly coins-in vs coins-out report. No real-money trading.

## 14. Kingdoms (Phase 4)
King/Queen, Dukes/Lords, Commanders/Knights, Guards/Citizens. Real powers: taxes, laws,
appointing officials, alliances, wars, titles, land grants, bounties. NPC officials fill
empty seats. Thrones can be lost by rebellion, election, conquest or events.

## 15. Monetisation (Phase 3+, global)
- Sell: outfits, hairstyles, armour/weapon skins, mount/pet skins (same speed), house themes,
  furniture skins, emotes, wedding/festival outfits, crest designs, extra character slots,
  saved outfit loadouts, second house layout, name change.
- Never sell: gear, stats, XP boosts, coins, tradeable items, faster crafting/farming/travel,
  extra loot, loot boxes, extra trade storage.
- Supporter pass ~US$3/month (regional pricing): monthly outfit, badge, cosmetic currency.
  Free seasonal track for everyone.
- Payments: Xsolla Web Shop (global merchant of record), optional Paystack for African
  markets. Under-18: parent permission + monthly cap.
- Ads only on portals like CrazyGames, opt-in rewarded ads for cosmetic rewards only.
  The main site stays ad-free.
- Languages via language files from day one (English first).

## 16. Growth features
Guest play in under 10 s; invite links that drop a friend into your party; installable PWA;
low-data mode; public Most Wanted page with shareable posters; the Herald; photo mode;
Discord bot posting events and bounties; public rules page and fast bans.
