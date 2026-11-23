import { audio, type AudioSettings } from "../audio";
import { account, ApiError } from "../account";

/** Gear button + settings panel (sound sliders). Built as HTML so it's sharp and accessible. */
export function mountSettings(root: HTMLElement) {
  const button = document.createElement("button");
  button.className = "btn square icon-btn";
  button.type = "button";
  button.setAttribute("aria-label", "Settings");
  button.setAttribute("aria-expanded", "false");
  button.textContent = "⚙";

  const panel = document.createElement("div");
  panel.id = "settings";
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Settings");

  const title = document.createElement("h2");
  title.textContent = "Settings";
  panel.append(title);

  const rows: Record<"music" | "ambience" | "effects", { input: HTMLInputElement; out: HTMLOutputElement }> =
    {} as never;
  for (const [key, label] of [
    ["music", "Music"],
    ["ambience", "Ambience"],
    ["effects", "Effects"],
  ] as const) {
    const row = document.createElement("label");
    row.className = "slider-row";
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "5";
    const out = document.createElement("output");
    input.addEventListener("input", () => {
      audio.set({ [key]: Number(input.value) / 100 } as Partial<AudioSettings>);
    });
    input.addEventListener("change", () => audio.play("select", { volume: 0.6 }));
    row.append(name, input, out);
    panel.append(row);
    rows[key] = { input, out };
  }

  const muteRow = document.createElement("label");
  muteRow.className = "toggle-row";
  const muteText = document.createElement("span");
  muteText.textContent = "Mute all sound";
  const mute = document.createElement("input");
  mute.type = "checkbox";
  mute.addEventListener("change", () => audio.set({ muted: mute.checked }));
  muteRow.append(muteText, mute);
  panel.append(muteRow);

  const render = (s: AudioSettings) => {
    for (const key of ["music", "ambience", "effects"] as const) {
      const pct = Math.round(s[key] * 100);
      rows[key].input.value = String(pct);
      rows[key].out.value = `${pct}`;
    }
    mute.checked = s.muted;
  };
  render(audio.settings);
  audio.onChange(render);

  panel.append(accountSection());

  const setOpen = (open: boolean) => {
    panel.classList.toggle("open", open);
    button.setAttribute("aria-expanded", String(open));
    audio.play(open ? "open" : "close", { volume: 0.7 });
  };
  button.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) setOpen(false);
  });

  root.append(button, panel);
}

/** "Your save": show a save code for other devices, or use one from another device. */
function accountSection(): HTMLElement {
  const box = document.createElement("section");
  box.innerHTML = `
    <h3>Your save</h3>
    <div class="account-row"><button class="btn" type="button" data-act="code">Show my save code</button></div>
    <div class="code-out" hidden>
      <p class="code" aria-live="polite"></p>
      <p class="note">Write this down and keep it secret. Use it to play this character on another device.
      Showing it again makes a new code and the old one stops working.</p>
    </div>
    <h3>Play on this device with a save code</h3>
    <div class="field">
      <input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="14"
        placeholder="ABCD-EFGH-JKMN" aria-label="Save code" />
      <button class="btn" type="button" data-act="login">Use</button>
    </div>
    <p class="note" data-msg role="status"></p>`;
  const msg = box.querySelector<HTMLElement>("[data-msg]")!;
  const out = box.querySelector<HTMLElement>(".code-out")!;
  box.querySelector<HTMLButtonElement>('[data-act="code"]')!.addEventListener("click", async () => {
    try {
      const code = await account.saveCode();
      out.hidden = false;
      out.querySelector(".code")!.textContent = code;
      audio.play("page");
    } catch {
      msg.textContent = "Couldn't make a code right now. Try again in a moment.";
      audio.play("error");
    }
  });
  const input = box.querySelector<HTMLInputElement>('input[name="code"]')!;
  box.querySelector<HTMLButtonElement>('[data-act="login"]')!.addEventListener("click", async () => {
    try {
      await account.loginWithCode(input.value);
      msg.textContent = "Welcome back! Reloading…";
      audio.play("confirm");
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      msg.textContent =
        e instanceof ApiError && e.status === 429 ? "Too many tries. Please wait a minute." : "That code didn't work. Check it and try again.";
      audio.play("error");
    }
  });
  return box;
}
