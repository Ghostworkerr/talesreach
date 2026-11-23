import { audio, type AudioSettings } from "../audio";

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
