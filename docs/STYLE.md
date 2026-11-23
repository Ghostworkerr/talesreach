# Talesreach — Art style

## The chosen family
**Kenney "Roguelike" series**, all CC0 (public domain), by Kenney (kenney.nl).
Every tile, character and prop in the game comes from this one family, so the world looks
like one place. The UI uses Kenney's **UI Pack: RPG Expansion**, whose parchment-and-wood
panels match the same earthy palette.

| Pack | Covers | File in `assets/` |
|---|---|---|
| Roguelike/RPG pack | outdoor town, forest, farmland, water, paths, buildings, roofs, fences, trees, props | `art/kenney-roguelike-rpg/roguelikeSheet_transparent.png` |
| Roguelike Characters | layered people: bodies (4 skin tones), legs, shirts/armour, hair, beards, hats, plus ready-made characters | `art/kenney-roguelike-characters/roguelikeChar_transparent.png` |
| Roguelike Indoors | inn/house interiors: floors, walls, tables, chairs, beds, kitchens, decorations | `art/kenney-roguelike-indoors/roguelikeIndoor_transparent.png` |
| UI Pack: RPG Expansion | panels, buttons, bars (health/stamina), arrows, icons, cursors | `ui/kenney-ui-rpg-expansion/*.png` |

Why this family: it is CC0 (no credit required, commercial use allowed), it covers town,
forest, farmland, interiors and characters in one consistent style, its characters are
paper-doll layers (ideal for the character creator), and it is tiny (~350 KB total), which
suits phones and the 15 MB first-download limit.

## Rules
- **Tile size: 16 × 16 px everywhere.** Sheets have a **1 px gap** between tiles
  (`margin: 0`, `spacing: 1` in Phaser/Tiled). Frame index = `row * columns + column`.
  - RPG sheet: 57 columns × 31 rows. Characters: 54 × 12. Indoors: 27 × 18.
- **Pixel art rendering:** `pixelArt: true` (nearest-neighbour, no smoothing). Scale only by
  whole numbers (the world camera is zoomed 2×).
- **One family only.** New art must come from the Kenney Roguelike series first. If
  something is missing, any addition must be CC0/CC-BY, 16 × 16, and match the palette
  below; record it in `assets/CREDITS.md`.
- **Characters** are built in layers, bottom to top: body → legs → shirt/armour → hair →
  beard → hat/helmet → held item. Characters face the camera.
- **Every action is animated** (owner's rule). The pack has no animation frames, so
  `client/src/character.ts` cuts each character into paper-doll pieces (body, two arms,
  two feet) and animates them in whole art pixels: walking lifts the feet in turn, swings
  the opposite arm, bobs the body and kicks up dust; standing still breathes. New actions
  (attack, gather, sit, emote, hit, downed…) add their own poses the same way.
- Positions are snapped to whole screen pixels so characters never shimmer against the map.
- **Text** is drawn as HTML/CSS overlay or Phaser text with a dark outline, never baked
  into art. Minimum 11 px world text at 2× zoom (22 px on screen).
- **UI** uses the beige/brown parchment panels and brown buttons; blue/grey variants only
  for secondary or disabled states. Buttons on phones are at least 44 × 44 px on screen.
- **Lighting and weather** (later tasks) tint the whole world; never repaint tiles for night.

## Palette (sampled from the sheets)
| Use | Colours |
|---|---|
| Grass | `#8dc435`, `#84bb2c` |
| Leafy trees | `#7bad2c`, `#648c32` |
| Pine trees | `#409c62`, `#307e4d` |
| Dirt path | `#b48355`, `#a07247` |
| Stone | `#a8b6b7`, `#b1bebf` |
| Sand | `#e6dabf`, `#d9caa9` |
| Water | `#63c5cf`, `#8ed4db` |
| Wood floor | `#b98b5e`, `#a87e54` |
| Roofs | `#c58f5c`, `#8d6640` |
| UI parchment text | `#f3e6c8` on dark `#1b1611` |

## Useful frames (first set)
- RPG sheet: grass `5`, grass alt `62`, dirt `6`, small decorations `541, 592, 598, 655`, leafy tree top/trunk
  `583`/`640`, pine top/trunk `588`/`645`, round bush `526`.
- Characters: ready-made people `270, 271, 324, 325, 378, 379, 432, 433, 486, 487, 540, 541`;
  bodies `0` (light) `54` `108` (dark) `162` (green).
