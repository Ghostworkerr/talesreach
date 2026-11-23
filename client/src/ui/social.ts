import type { Room } from "@colyseus/sdk";
import { CHAT_MAX, REPORT_REASONS } from "@talesreach/shared";
import { audio } from "../audio";

/**
 * Chat and player-safety UI: chat log + input, player menu (party invite,
 * mute, block, report), report form, party invite prompt and party list.
 * Mute is device-only; block and report go to the server.
 */
const MUTE_KEY = "talesreach.muted";
const REASON_LABELS: Record<(typeof REPORT_REASONS)[number], string> = {
  language: "Bad language",
  bullying: "Bullying or harassment",
  personal_info: "Asking for or sharing personal details",
  inappropriate: "Inappropriate or sexual content",
  cheating: "Cheating",
  other: "Something else",
};
const SHOWN_LINES = 6;
const LOG_LIMIT = 60;

export interface SocialHooks {
  /** Show a speech bubble over a player's head. */
  bubble(pid: string, text: string): void;
  /** Is this pid me? */
  isMe(pid: string): boolean;
  /** Called when typing starts/stops (the game ignores movement keys while typing). */
  typing(active: boolean): void;
}

export class SocialUI {
  private readonly log: HTMLElement;
  private readonly bar: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly partyBox: HTMLElement;
  private channel: "local" | "party" = "local";
  private partyMembers: { pid: string; name: string }[] = [];
  private readonly muted = new Set<string>(loadMuted());
  private readonly blocked = new Set<string>();
  private menu: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly room: Room,
    private readonly hooks: SocialHooks,
  ) {
    this.log = el("div", "chat-log");
    this.log.setAttribute("aria-live", "polite");
    this.log.addEventListener("click", () => this.log.classList.toggle("expanded"));

    this.bar = el("form", "chat-bar panel") as HTMLFormElement;
    this.bar.innerHTML = `
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-ch="local" aria-selected="true">Local</button>
        <button type="button" role="tab" data-ch="party" aria-selected="false" disabled>Party</button>
      </div>
      <input name="text" maxlength="${CHAT_MAX}" autocomplete="off" enterkeyhint="send" placeholder="Say something nice…" aria-label="Chat message" />
      <button class="btn" type="submit">Send</button>`;
    this.input = this.bar.querySelector("input")!;
    this.bar.addEventListener("submit", (e) => {
      e.preventDefault();
      this.send();
    });
    this.bar.querySelectorAll<HTMLButtonElement>("[data-ch]").forEach((b) =>
      b.addEventListener("click", () => this.setChannel(b.dataset.ch as "local" | "party")),
    );
    this.input.addEventListener("focus", () => hooks.typing(true));
    this.input.addEventListener("blur", () => hooks.typing(false));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeBar();
      e.stopPropagation();
    });

    const chatBtn = el("button", "btn square chat-btn") as HTMLButtonElement;
    chatBtn.type = "button";
    chatBtn.textContent = "💬";
    chatBtn.setAttribute("aria-label", "Chat");
    chatBtn.addEventListener("click", () => (this.bar.classList.contains("open") ? this.closeBar() : this.openBar()));

    this.partyBox = el("div", "party-box panel");
    this.partyBox.hidden = true;

    root.append(this.log, this.bar, chatBtn, this.partyBox);

    // PC: Enter opens chat (when not already typing somewhere).
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || isTyping()) return;
      e.preventDefault();
      this.openBar();
    });

    room.onMessage("chat", (m: { pid: string; name: string; channel: string; text: string }) => {
      if (this.muted.has(m.pid)) return;
      this.addLine(m.channel === "party" ? "party" : "local", m.name, m.text);
      if (m.channel === "local") hooks.bubble(m.pid, m.text);
      if (!hooks.isMe(m.pid)) audio.play("select", { volume: 0.25 });
    });
    room.onMessage("notice", (m: { text: string }) => this.addSystem(m.text));
    room.onMessage("blocked", (m: { pid: string }) => {
      this.blocked.add(m.pid);
      this.addSystem("Blocked. You won't see each other's messages or invites.");
    });
    room.onMessage("unblocked", (m: { pid: string }) => {
      this.blocked.delete(m.pid);
      this.addSystem("Unblocked.");
    });
    room.onMessage("reported", () => this.addSystem("Thank you. A moderator will look at your report."));
    room.onMessage("partyInvite", (m: { pid: string; name: string }) => this.showInvite(m.pid, m.name));
    room.onMessage("party", (m: { members: { pid: string; name: string }[] }) => this.showParty(m.members));
    room.onMessage("rejected", (m: { reason: string }) => {
      const friendly: Record<string, string> = {
        "slow down": "Slow down a little before sending more.",
        "no spamming": "Please don't repeat the same message.",
        "not in a party": "You're not in a party yet. Tap a player to invite them.",
        "party is full": "Parties can have up to 5 travellers.",
        "too many reports": "You've sent several reports. Thank you — a moderator will look.",
        "player not found": "That traveller isn't here any more.",
      };
      const text = friendly[m.reason];
      if (text) this.addSystem(text);
    });
  }

  // ------------------------------------------------------------------ chat bar
  private openBar() {
    this.bar.classList.add("open");
    this.input.focus();
    audio.play("open", { volume: 0.4 });
  }

  private closeBar() {
    this.bar.classList.remove("open");
    this.input.blur();
  }

  private setChannel(ch: "local" | "party") {
    if (ch === "party" && this.partyMembers.length < 2) return;
    this.channel = ch;
    this.bar.querySelectorAll<HTMLButtonElement>("[data-ch]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.ch === ch)));
    this.bar.classList.toggle("party", ch === "party");
  }

  private send() {
    const text = this.input.value.trim();
    if (!text) return this.closeBar();
    this.room.send("chat", { channel: this.channel, text });
    this.input.value = "";
    // Phones: close the keyboard after sending; PC keeps the box open for a reply.
    if (matchMedia("(pointer: coarse)").matches) this.closeBar();
  }

  private addLine(kind: "local" | "party", name: string, text: string) {
    const line = el("p", `line ${kind}`);
    const who = el("b");
    who.textContent = kind === "party" ? `[Party] ${name}: ` : `${name}: `;
    line.append(who, document.createTextNode(text));
    this.push(line);
  }

  private addSystem(text: string) {
    const line = el("p", "line system");
    line.textContent = text;
    this.push(line);
  }

  private push(line: HTMLElement) {
    this.log.append(line);
    while (this.log.childElementCount > LOG_LIMIT) this.log.firstElementChild?.remove();
    // Only the last few lines stay visible unless the log is expanded.
    [...this.log.children].forEach((c, i, all) => c.classList.toggle("old", i < all.length - SHOWN_LINES));
    this.log.scrollTop = this.log.scrollHeight;
  }

  // ------------------------------------------------------------------ player menu
  /** Tapped another player: invite, mute, block or report. */
  openPlayerMenu(pid: string, name: string, screenX: number, screenY: number) {
    this.closeMenu();
    const menu = el("div", "player-menu panel");
    menu.setAttribute("role", "menu");
    const title = el("h3");
    title.textContent = name;
    menu.append(title);
    const add = (label: string, fn: () => void, danger = false) => {
      const b = el("button", `btn${danger ? " danger" : ""}`) as HTMLButtonElement;
      b.type = "button";
      b.textContent = label;
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", () => {
        this.closeMenu();
        audio.play("click", { volume: 0.5 });
        fn();
      });
      menu.append(b);
    };
    if (!this.blocked.has(pid)) add("Invite to party", () => this.room.send("partyInvite", { pid }));
    if (this.muted.has(pid)) add("Unmute", () => this.setMuted(pid, false, name));
    else add("Mute", () => this.setMuted(pid, true, name));
    if (this.blocked.has(pid)) add("Unblock", () => this.room.send("unblock", { pid }));
    else add("Block", () => this.room.send("block", { pid }), true);
    add("Report…", () => this.openReport(pid, name), true);
    menu.style.left = `${Math.max(8, Math.min(screenX, innerWidth - 200))}px`;
    menu.style.top = `${Math.max(8, Math.min(screenY, innerHeight - 260))}px`;
    this.root.append(menu);
    this.menu = menu;
    setTimeout(() => document.addEventListener("pointerdown", this.outside, { once: true }), 0);
  }

  private outside = (e: PointerEvent) => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
    else if (this.menu) document.addEventListener("pointerdown", this.outside, { once: true });
  };

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  private setMuted(pid: string, on: boolean, name: string) {
    if (on) this.muted.add(pid);
    else this.muted.delete(pid);
    saveMuted(this.muted);
    this.addSystem(on ? `Muted ${name}. Only you can't see their messages.` : `Unmuted ${name}.`);
  }

  // ------------------------------------------------------------------ report
  private openReport(pid: string, name: string) {
    const overlay = el("div", "overlay");
    const form = el("form", "panel report") as HTMLFormElement;
    form.innerHTML = `<h1>Report ${escapeHtml(name)}</h1>
      <p>What happened? A moderator will look at their recent chat. They won't know who reported them.</p>
      <fieldset class="reasons">${REPORT_REASONS.map(
        (r, i) => `<label><input type="radio" name="reason" value="${r}" ${i === 0 ? "checked" : ""}/> ${REASON_LABELS[r]}</label>`,
      ).join("")}</fieldset>
      <label class="note"><span>Anything else? (optional)</span><textarea name="note" maxlength="300" rows="2"></textarea></label>
      <div class="row"><button class="btn" type="button" data-act="cancel">Cancel</button><button class="btn danger" type="submit">Send report</button></div>`;
    overlay.append(form);
    this.root.append(overlay);
    const close = () => overlay.remove();
    form.querySelector('[data-act="cancel"]')!.addEventListener("click", close);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      this.room.send("report", { pid, reason: String(data.get("reason")), note: String(data.get("note") ?? "").slice(0, 300) });
      // Reporting also hides them from you straight away.
      this.muted.add(pid);
      saveMuted(this.muted);
      audio.play("confirm", { volume: 0.6 });
      close();
    });
  }

  // ------------------------------------------------------------------ party
  private showInvite(pid: string, name: string) {
    if (this.muted.has(pid)) return this.room.send("partyRespond", { accept: false });
    const toast = el("div", "invite panel");
    toast.innerHTML = `<p><b>${escapeHtml(name)}</b> invites you to their party.</p>
      <div class="row"><button class="btn" type="button" data-a="no">Decline</button><button class="btn" type="button" data-a="yes">Join</button></div>`;
    this.root.append(toast);
    audio.play("jingleQuest", { volume: 0.4 });
    const answer = (accept: boolean) => {
      this.room.send("partyRespond", { accept });
      toast.remove();
    };
    toast.querySelector('[data-a="yes"]')!.addEventListener("click", () => answer(true));
    toast.querySelector('[data-a="no"]')!.addEventListener("click", () => answer(false));
    setTimeout(() => toast.isConnected && toast.remove(), 55_000);
  }

  private showParty(members: { pid: string; name: string }[]) {
    this.partyMembers = members;
    const partyTab = this.bar.querySelector<HTMLButtonElement>('[data-ch="party"]')!;
    partyTab.disabled = members.length < 2;
    if (members.length < 2) {
      this.partyBox.hidden = true;
      if (this.channel === "party") this.setChannel("local");
      return;
    }
    this.partyBox.hidden = false;
    this.partyBox.innerHTML = `<h3>Party</h3><ul>${members.map((m) => `<li>${escapeHtml(m.name)}${this.hooks.isMe(m.pid) ? " (you)" : ""}</li>`).join("")}</ul>`;
    const leave = el("button", "btn") as HTMLButtonElement;
    leave.type = "button";
    leave.textContent = "Leave";
    leave.addEventListener("click", () => this.room.send("partyLeave", {}));
    this.partyBox.append(leave);
    this.addSystem(`Party: ${members.map((m) => m.name).join(", ")}`);
  }
}

function el(tag: string, cls = ""): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function isTyping(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
}

function loadMuted(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MUTE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  } catch {
    return [];
  }
}

function saveMuted(set: Set<string>) {
  try {
    localStorage.setItem(MUTE_KEY, JSON.stringify([...set]));
  } catch {
    // storage blocked: mute lasts for this session only
  }
}
