import { audio } from "../audio";

/**
 * A small cutscene system (docs/DESIGN_NOTES.md): scenes are written as data,
 * shown with letterbox bars, narration that types itself out, a tap to go on,
 * and a Skip button. Quests reuse it later for dialogue scenes.
 */
export type CutsceneStep =
  | { narrate: string }
  | { say: string; speaker: string }
  | { pan: { x: number; y: number }; ms: number; wait?: boolean }
  | { wait: number };

export interface CutsceneHooks {
  /** Move the world camera smoothly to a point (world pixels). */
  pan(x: number, y: number, ms: number): void;
}

const TYPE_MS_PER_CHAR = 28;

export function playCutscene(root: HTMLElement, steps: CutsceneStep[], hooks: CutsceneHooks): Promise<void> {
  return new Promise((resolve) => {
    const scene = document.createElement("div");
    scene.className = "cutscene";
    scene.innerHTML = `
      <div class="bar top"></div><div class="bar bottom"></div>
      <p class="narration" aria-live="polite"></p>
      <div class="dialogue panel" hidden><span class="speaker"></span><p class="line"></p></div>
      <p class="hint">Tap to continue</p>
      <button class="btn skip" type="button">Skip ▸▸</button>`;
    root.append(scene);
    requestAnimationFrame(() => scene.classList.add("on"));

    const narration = scene.querySelector<HTMLElement>(".narration")!;
    const dialogue = scene.querySelector<HTMLElement>(".dialogue")!;
    const speaker = scene.querySelector<HTMLElement>(".speaker")!;
    const line = scene.querySelector<HTMLElement>(".line")!;
    const hint = scene.querySelector<HTMLElement>(".hint")!;

    let index = -1;
    let typing: { el: HTMLElement; full: string; timer: number } | null = null;
    let waitTimer = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(typing?.timer);
      clearTimeout(waitTimer);
      scene.classList.remove("on");
      scene.classList.add("off");
      setTimeout(() => scene.remove(), 450);
      resolve();
    };

    const type = (el: HTMLElement, text: string) => {
      el.textContent = "";
      hint.classList.remove("show");
      let i = 0;
      const timer = window.setInterval(() => {
        i++;
        el.textContent = text.slice(0, i);
        if (i >= text.length) {
          clearInterval(timer);
          typing = null;
          hint.classList.add("show");
        }
      }, TYPE_MS_PER_CHAR);
      typing = { el, full: text, timer };
    };

    const next = () => {
      if (done) return;
      index++;
      const step = steps[index];
      if (!step) return finish();
      if ("narrate" in step) {
        dialogue.hidden = true;
        narration.hidden = false;
        type(narration, step.narrate);
        audio.play("page", { volume: 0.35 });
      } else if ("say" in step) {
        narration.hidden = true;
        dialogue.hidden = false;
        speaker.textContent = step.speaker;
        type(line, step.say);
      } else if ("pan" in step) {
        hooks.pan(step.pan.x, step.pan.y, step.ms);
        if (step.wait) waitTimer = window.setTimeout(next, step.ms);
        else next();
      } else {
        waitTimer = window.setTimeout(next, step.wait);
      }
    };

    // Tap: finish typing first, then go on (only while text is on screen).
    scene.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".skip")) return;
      if (typing) {
        clearInterval(typing.timer);
        typing.el.textContent = typing.full;
        typing = null;
        hint.classList.add("show");
        return;
      }
      const step = steps[index];
      if (step && ("narrate" in step || "say" in step)) next();
    });
    scene.querySelector(".skip")!.addEventListener("click", () => {
      audio.play("click", { volume: 0.5 });
      finish();
    });
    document.addEventListener(
      "keydown",
      function onKey(e) {
        if (done) return document.removeEventListener("keydown", onKey);
        if (e.key === "Escape") finish();
        else if (e.key === "Enter" || e.key === " ") scene.click();
      },
    );

    next();
  });
}
