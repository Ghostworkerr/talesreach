import { account, ApiError } from "../account";
import { audio } from "../audio";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * First-visit screen: asks for date of birth before any account exists.
 * Neutral wording (it does not say which age is needed), so it can't be gamed.
 * Resolves once the device has an account.
 */
export function showAgeGate(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const panel = document.createElement("form");
    panel.className = "panel gate";
    panel.setAttribute("aria-labelledby", "gate-title");

    if (account.isBlocked()) {
      panel.innerHTML = `<h1 id="gate-title">Talesreach</h1><p>Sorry — Talesreach is for players aged 13 and over. Thank you for visiting!</p>`;
      overlay.append(panel);
      root.append(overlay);
      return; // never resolves: no account is created
    }

    const year = new Date().getFullYear();
    const opts = (from: number, to: number, label: (n: number) => string) =>
      Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => {
        const n = from < to ? from + i : from - i;
        return `<option value="${n}">${label(n)}</option>`;
      }).join("");
    panel.innerHTML = `
      <h1 id="gate-title">Welcome, traveller</h1>
      <p>Before you step into the Crossroads Inn, please tell us your date of birth.
      We use it only to keep younger players safe, and never show it to anyone.</p>
      <fieldset class="dob">
        <legend>Date of birth</legend>
        <label><span>Day</span><select name="day" required><option value="">Day</option>${opts(1, 31, String)}</select></label>
        <label><span>Month</span><select name="month" required><option value="">Month</option>${opts(1, 12, (n) => MONTHS[n - 1]!)}</select></label>
        <label><span>Year</span><select name="year" required><option value="">Year</option>${opts(year, year - 100, String)}</select></label>
      </fieldset>
      <p class="error" role="alert"></p>
      <button class="btn" type="submit">Enter the world</button>
      <p class="small">Already playing on another device? Use your save code in ⚙ Settings after you enter.</p>`;
    overlay.append(panel);
    root.append(overlay);

    const error = panel.querySelector<HTMLElement>(".error")!;
    const button = panel.querySelector<HTMLButtonElement>("button")!;
    panel.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(panel);
      const d = Number(f.get("day"));
      const m = Number(f.get("month"));
      const y = Number(f.get("year"));
      if (!d || !m || !y) {
        error.textContent = "Please choose a day, month and year.";
        audio.play("error");
        return;
      }
      const dob = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      button.disabled = true;
      button.textContent = "Opening the door…";
      try {
        await account.createGuest(dob);
        audio.play("confirm");
        overlay.classList.add("leaving");
        setTimeout(() => overlay.remove(), 250);
        resolve();
      } catch (err) {
        button.disabled = false;
        button.textContent = "Enter the world";
        if (err instanceof ApiError && err.code === "too_young") {
          panel.innerHTML = `<h1>Talesreach</h1><p>Sorry — Talesreach is for players aged 13 and over. Thank you for visiting!</p>`;
        } else if (err instanceof ApiError && err.code === "invalid_request") {
          error.textContent = "That date doesn't look right. Please check it.";
        } else {
          error.textContent = "The world is still waking up. Please try again in a moment.";
        }
      }
    });
  });
}
