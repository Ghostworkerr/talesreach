import {
  BEARD_OFFSETS,
  BODY_FRAMES,
  HAIR_COLOUR_ORIGINS,
  HAIR_STYLE_OFFSETS,
  HAT_FRAMES,
  LEG_FRAMES,
  NAME_IDEAS,
  OUTFIT_FRAMES,
  checkName,
  randomAppearance,
  type Appearance,
} from "@talesreach/shared";
import { account, ApiError } from "../account";
import { audio } from "../audio";
import { drawDoll } from "../doll";
import { DRAW_ORDER, PIECES, idlePose, walkPose, type Pose } from "../character";
import { DPR } from "../display";

type Key = keyof Appearance;
interface Option {
  key: Key;
  label: string;
  count: number;
  /** Text shown for the current value. */
  show: (v: number) => string;
}

const SKINS = ["Fair", "Tan", "Brown", "Green"];
const OPTIONS: Option[] = [
  { key: "body", label: "Skin", count: BODY_FRAMES.length / 2, show: (v) => SKINS[v] ?? "" },
  { key: "body", label: "Build", count: 2, show: (v) => (v === 0 ? "Broad" : "Slim") },
  { key: "hairStyle", label: "Hair", count: HAIR_STYLE_OFFSETS.length, show: (v) => (v === 0 ? "None" : `Style ${v}`) },
  { key: "hairColour", label: "Colour", count: HAIR_COLOUR_ORIGINS.length, show: (v) => HAIR_COLOUR_ORIGINS[v]?.name ?? "" },
  { key: "beard", label: "Beard", count: BEARD_OFFSETS.length, show: (v) => (v === 0 ? "None" : `Style ${v}`) },
  { key: "hat", label: "Head", count: HAT_FRAMES.length, show: (v) => (v === 0 ? "None" : `Style ${v}`) },
  { key: "outfit", label: "Outfit", count: OUTFIT_FRAMES.length, show: (v) => `${v + 1} / ${OUTFIT_FRAMES.length}` },
  { key: "legs", label: "Legs", count: LEG_FRAMES.length, show: (v) => `${v + 1} / ${LEG_FRAMES.length}` },
];

/** Skin and build share the `body` number: body = skin * 2 + build. */
function getValue(a: Appearance, o: Option): number {
  if (o.label === "Skin") return Math.floor(a.body / 2);
  if (o.label === "Build") return a.body % 2;
  return a[o.key];
}
function setValue(a: Appearance, o: Option, v: number): Appearance {
  if (o.label === "Skin") return { ...a, body: v * 2 + (a.body % 2) };
  if (o.label === "Build") return { ...a, body: Math.floor(a.body / 2) * 2 + v };
  return { ...a, [o.key]: v };
}

const NAME_MESSAGES: Record<string, string> = {
  name_length: "Names are 3 to 16 letters long.",
  name_characters: "Use letters only (spaces, ' and - are fine between letters).",
  name_blocked: "Please choose a kinder name.",
  name_taken: "Another traveller already has that name. Try another!",
};

/**
 * The character creator. Shows a live, animated preview; saves name + look on
 * the server (which re-checks everything) and resolves when done.
 */
export function showCreator(root: HTMLElement, sheet: CanvasImageSource, start?: Appearance): Promise<{ name: string; appearance: Appearance }> {
  return new Promise((resolve) => {
    let look: Appearance = start ?? randomAppearance();
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const panel = document.createElement("form");
    panel.className = "panel creator";
    panel.setAttribute("aria-labelledby", "creator-title");
    panel.innerHTML = `
      <h1 id="creator-title">Who are you, traveller?</h1>
      <div class="creator-body">
        <div class="preview-wrap">
          <canvas class="preview" aria-label="Your character"></canvas>
          <button class="btn" type="button" data-act="random">🎲 Random look</button>
        </div>
        <div class="choices"></div>
      </div>
      <label class="name-row"><span>Name</span>
        <span class="field">
          <input name="name" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Your name" />
          <button class="btn square" type="button" data-act="name" aria-label="Suggest a name">🎲</button>
        </span>
      </label>
      <p class="error" role="alert"></p>
      <button class="btn begin" type="submit">Begin your tale</button>`;
    // Short screens: put "Begin" beside the name so the whole creator fits without scrolling.
    if (window.innerHeight <= 440) panel.querySelector(".name-row")!.append(panel.querySelector(".begin")!);
    overlay.append(panel);
    root.append(overlay);

    // --- option rows ---
    const choices = panel.querySelector<HTMLElement>(".choices")!;
    const valueEls: HTMLElement[] = [];
    OPTIONS.forEach((o, i) => {
      const row = document.createElement("div");
      row.className = "choice";
      row.innerHTML = `<span class="label">${o.label}</span>
        <button class="arrow" type="button" aria-label="Previous ${o.label}">◀</button>
        <span class="value" aria-live="polite"></span>
        <button class="arrow" type="button" aria-label="Next ${o.label}">▶</button>`;
      const [prev, next] = row.querySelectorAll<HTMLButtonElement>(".arrow");
      const step = (d: number) => {
        const v = (getValue(look, o) + d + o.count) % o.count;
        look = setValue(look, o, v);
        audio.play("click", { volume: 0.5 });
        render();
      };
      prev!.addEventListener("click", () => step(-1));
      next!.addEventListener("click", () => step(1));
      valueEls[i] = row.querySelector(".value")!;
      choices.append(row);
    });
    const render = () => OPTIONS.forEach((o, i) => (valueEls[i]!.textContent = o.show(getValue(look, o))));
    render();

    panel.querySelector('[data-act="random"]')!.addEventListener("click", () => {
      look = randomAppearance();
      audio.play("cloth", { volume: 0.6 });
      render();
    });
    const nameInput = panel.querySelector<HTMLInputElement>('input[name="name"]')!;
    panel.querySelector('[data-act="name"]')!.addEventListener("click", () => {
      nameInput.value = NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)]!;
      audio.play("page", { volume: 0.6 });
    });

    // --- animated preview: walks a few steps each way, then rests and breathes ---
    const canvas = panel.querySelector<HTMLCanvasElement>(".preview")!;
    const SCALE = 6;
    canvas.width = 24 * SCALE * DPR;
    canvas.height = 22 * SCALE * DPR;
    const ctx = canvas.getContext("2d")!;
    const doll = document.createElement("canvas");
    doll.width = 16;
    doll.height = 16;
    const dctx = doll.getContext("2d")!;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const cycle = t % 6; // 0-2.4 walk right, 2.4-3 rest, 3-5.4 walk left, 5.4-6 rest
      const walking = cycle < 2.4 || (cycle >= 3 && cycle < 5.4);
      const facing = cycle < 3 ? 1 : -1;
      const pose: Pose = walking ? walkPose((t * 1.5) % 1, true) : idlePose(Math.sin(t * 2.6) > 0.6);
      dctx.clearRect(0, 0, 16, 16);
      drawDoll(dctx, sheet, look);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      const s = SCALE * DPR;
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(12 * s, 19.5 * s, 6 * s, 2 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.setTransform(facing * s, 0, 0, s, facing === 1 ? 4 * s : 20 * s, 3 * s);
      for (const name of DRAW_ORDER) {
        const [x, y, w, h] = PIECES[name];
        const [ox, oy] = pose[name];
        ctx.drawImage(doll, x, y, w, h, x + ox, y + oy, w, h);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // --- save ---
    const error = panel.querySelector<HTMLElement>(".error")!;
    const begin = panel.querySelector<HTMLButtonElement>(".begin")!;
    panel.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { name, problem } = checkName(nameInput.value);
      if (problem) {
        error.textContent = NAME_MESSAGES[`name_${problem}`] ?? "Please choose another name.";
        audio.play("error");
        nameInput.focus();
        return;
      }
      begin.disabled = true;
      begin.textContent = "Saving…";
      try {
        const saved = await account.saveProfile(name, look);
        audio.play("jingleWelcome", { volume: 0.7 });
        cancelAnimationFrame(raf);
        overlay.classList.add("leaving");
        setTimeout(() => overlay.remove(), 250);
        resolve(saved);
      } catch (err) {
        begin.disabled = false;
        begin.textContent = "Begin your tale";
        error.textContent =
          err instanceof ApiError ? (NAME_MESSAGES[err.code] ?? "Something went wrong. Please try again.") : "The world is still waking up. Try again in a moment.";
        audio.play("error");
      }
    });
  });
}
