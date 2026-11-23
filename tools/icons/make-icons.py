"""Make the Talesreach app icons from the game's own art (Kenney Roguelike, CC0).

Run from the repo root:  python tools/icons/make-icons.py
Writes web/icons/*.png: a pixel-art traveller on a parchment badge, in the sizes
browsers and phones ask for (including a "maskable" icon with a safe margin).
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
CHARS = ROOT / "assets/art/kenney-roguelike-characters/roguelikeChar_transparent.png"
RPG = ROOT / "assets/art/kenney-roguelike-rpg/roguelikeSheet_transparent.png"
OUT = ROOT / "web/icons"
OUT.mkdir(parents=True, exist_ok=True)

sheet = Image.open(CHARS).convert("RGBA")
rpg = Image.open(RPG).convert("RGBA")


def tile(img, frame, cols):
    r, c = divmod(frame, cols)
    return img.crop((c * 17, r * 17, c * 17 + 16, r * 17 + 16))


# A layered traveller: body, legs, outfit, hair (same paper-doll layers as the game).
doll = Image.new("RGBA", (16, 16))
for f in [0, 57, 6 + 54 * 3, 19 + 54 * 1]:
    doll.alpha_composite(tile(sheet, f, 54))
torch = tile(rpg, 416, 57)
grass = tile(rpg, 5, 57)

PARCHMENT = (233, 216, 180, 255)
WOOD = (110, 74, 44, 255)
NIGHT = (27, 22, 17, 255)


def badge(size, maskable=False):
    img = Image.new("RGBA", (size, size), NIGHT if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = 0 if maskable else round(size * 0.04)
    radius = round(size * 0.18)
    d.rounded_rectangle([pad, pad, size - 1 - pad, size - 1 - pad], radius=radius, fill=PARCHMENT, outline=WOOD, width=max(2, size // 32))
    # Safe zone: maskable icons keep the art inside the central ~70%.
    inner = 0.62 if maskable else 0.74
    scale = max(1, int(size * inner / 16))
    art = doll.resize((16 * scale, 16 * scale), Image.NEAREST)
    # Grass strip under the traveller's feet, and a torch beside them.
    g = grass.resize((16 * scale // 2, 16 * scale // 2), Image.NEAREST)
    cx = (size - art.width) // 2
    cy = (size - art.height) // 2 + scale
    ground_y = cy + art.height - g.height // 2 - scale
    for gx in range(0, size, g.width):
        for gy in range(ground_y, size, g.height):
            img.alpha_composite(g, (gx, gy))
    # Keep the grass inside the badge shape.
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad + 2, pad + 2, size - 3 - pad, size - 3 - pad], radius=radius, fill=255)
    base = Image.new("RGBA", (size, size), NIGHT if maskable else (0, 0, 0, 0))
    ImageDraw.Draw(base).rounded_rectangle([pad, pad, size - 1 - pad, size - 1 - pad], radius=radius, fill=PARCHMENT, outline=WOOD, width=max(2, size // 32))
    base.paste(img, (0, 0), mask)
    tscale = max(1, scale * 2 // 5)
    t = torch.resize((16 * tscale, 16 * tscale), Image.NEAREST)
    margin = pad + round(size * (0.1 if maskable else 0.06))
    base.alpha_composite(t, (size - margin - t.width, ground_y - t.height + tscale * 3))
    base.alpha_composite(art, (cx, cy - scale))
    return base


for name, size, maskable in [
    ("icon-512.png", 512, False),
    ("icon-192.png", 192, False),
    ("maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, True),
    ("favicon-32.png", 32, False),
]:
    badge(size, maskable).save(OUT / name)
    print("wrote", name)
