import type { Room } from "@colyseus/sdk";
import type { WorldTime, Wallet } from "@talesreach/shared";
import { audio, type SfxName } from "../audio";

interface DialogMsg {
  speaker: string;
  point: string;
  text: string;
  options: { id: string; label: string }[];
}

const PART_ICON: Record<string, string> = {
  Night: "🌙", Dawn: "🌅", Morning: "☀️", Midday: "☀️", Afternoon: "☀️", Dusk: "🌇", Evening: "🌙",
};

/**
 * Heads-up display: world clock + coins, the context action button ("Talk",
 * "Your room"), dialogs with choices, and the room chest.
 */
export class Hud {
  private readonly clock: HTMLElement;
  private readonly coins: HTMLElement;
  private readonly action: HTMLButtonElement;
  private dialog: HTMLElement | null = null;
  private actionTarget: string | null = null;
  wallet: Wallet = { coins: 0, chest: 0, roomUntil: 0, restPoint: null };

  constructor(
    private readonly root: HTMLElement,
    private readonly room: Room,
  ) {
    const box = el("div", "hud panel");
    this.clock = el("div", "hud-clock");
    this.coins = el("div", "hud-coins");
    this.coins.setAttribute("aria-label", "Coins");
    box.append(this.clock, this.coins);

    this.action = el("button", "btn action-btn") as HTMLButtonElement;
    this.action.type = "button";
    this.action.hidden = true;
    this.action.addEventListener("click", () => this.useAction());
    root.append(box, this.action);

    document.addEventListener("keydown", (e) => {
      if ((e.key === "e" || e.key === "E") && !isTyping() && !this.action.hidden) this.useAction();
      if (e.key === "Escape") this.closeDialog();
    });

    room.onMessage("wallet", (w: Wallet) => {
      const gained = w.coins - this.wallet.coins;
      this.wallet = w;
      this.coins.textContent = `🪙 ${w.coins}`;
      if (gained !== 0) this.coins.animate([{ transform: "scale(1.25)" }, { transform: "scale(1)" }], { duration: 300, easing: "ease-out" });
    });
    room.onMessage("dialog", (d: DialogMsg) => this.showDialog(d));
    room.onMessage("sound", (m: { name: string }) => audio.play(m.name as SfxName, { volume: 0.7 }));
  }

  setTime(t: WorldTime) {
    const hh = String(t.hour).padStart(2, "0");
    const mm = String(Math.floor(t.minute / 10) * 10).padStart(2, "0");
    const text = `${PART_ICON[t.part] ?? ""} ${hh}:${mm} · ${t.part}`;
    if (this.clock.textContent !== text) {
      this.clock.textContent = text;
      this.clock.title = `${t.season}, day ${t.seasonDay}`;
    }
  }

  /** Show (or hide) the context action for the nearest usable thing. */
  setAction(target: { name: string; label: string } | null) {
    const name = target?.name ?? null;
    if (name === this.actionTarget) return;
    this.actionTarget = name;
    this.action.hidden = !target;
    if (target) {
      this.action.textContent = target.label;
      this.action.animate([{ transform: "scale(0.8)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 160, easing: "ease-out" });
    }
  }

  private useAction() {
    if (!this.actionTarget) return;
    audio.play("click", { volume: 0.5 });
    this.room.send("interact", { target: this.actionTarget });
  }

  // ------------------------------------------------------------- dialog
  private showDialog(d: DialogMsg) {
    this.closeDialog();
    const box = el("div", "dialog panel");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", d.speaker);
    const name = el("span", "speaker");
    name.textContent = d.speaker;
    const text = el("p", "line");
    text.textContent = d.text;
    const opts = el("div", "options");
    for (const o of d.options) {
      const b = el("button", "btn") as HTMLButtonElement;
      b.type = "button";
      b.textContent = o.label;
      b.addEventListener("click", () => this.choose(o.id));
      opts.append(b);
    }
    box.append(name, text, opts);
    this.root.append(box);
    this.dialog = box;
    audio.play("page", { volume: 0.4 });
    (opts.firstElementChild as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  private choose(id: string) {
    audio.play("click", { volume: 0.5 });
    this.closeDialog();
    if (id === "rentRoom") this.room.send("rentRoom", {});
    else if (id.startsWith("rest:")) this.room.send("rest", { point: id.slice(5) });
    else if (id === "chest") this.openChest();
    else if (id.startsWith("say:")) this.room.send("interact", { target: id.slice(4) });
    else if (id.startsWith("song:")) this.room.send("requestSong", { song: Number(id.slice(5)) });
  }

  closeDialog() {
    this.dialog?.remove();
    this.dialog = null;
  }

  // ------------------------------------------------------------- chest
  private openChest() {
    const box = el("div", "dialog panel chest");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Chest");
    const render = () => {
      box.querySelector(".purse")!.textContent = `On you: 🪙 ${this.wallet.coins}`;
      box.querySelector(".stash")!.textContent = `In the chest: 🪙 ${this.wallet.chest}`;
    };
    box.innerHTML = `<span class="speaker">Chest</span>
      <p class="purse"></p><p class="stash"></p>
      <div class="options">
        <button class="btn" data-a="5" type="button">Put in 5</button>
        <button class="btn" data-a="all-in" type="button">Put in all</button>
        <button class="btn" data-a="-5" type="button">Take 5</button>
        <button class="btn" data-a="all-out" type="button">Take all</button>
        <button class="btn" data-a="close" type="button">Close</button>
      </div>`;
    render();
    const unsub = this.room.onMessage("wallet", () => render());
    box.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) =>
      b.addEventListener("click", () => {
        const a = b.dataset.a!;
        if (a === "close") {
          unsub();
          box.remove();
          this.dialog = null;
          return;
        }
        const amount = a === "all-in" ? this.wallet.coins : a === "all-out" ? -this.wallet.chest : Number(a);
        if (amount !== 0) this.room.send("chest", { amount });
      }),
    );
    this.closeDialog();
    this.root.append(box);
    this.dialog = box;
  }
}

function el(tag: string, cls = ""): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function isTyping(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
}
