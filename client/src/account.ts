import { serverUrl } from "./net";
import type { AccountInfo } from "@talesreach/shared";

/**
 * Device-side account handling. The device keeps a random token (its login).
 * The date of birth is also kept on this device only, so the game can quietly
 * re-create a guest account if the server forgot it (e.g. before a database is
 * connected) without asking the player again.
 */
const KEYS = { token: "talesreach.token", dob: "talesreach.dob", blocked: "talesreach.ageBlockedUntil" } as const;
const BLOCK_MS = 24 * 60 * 60 * 1000;

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // Storage blocked (private mode): the session still works, it just won't be remembered.
  }
};

/** HTTP base of the game server (same host as the WebSocket). */
export function apiBase(): string {
  return serverUrl().replace(/^ws/, "http").replace(/\/$/, "");
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function api<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(`${apiBase()}/api${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error");
  return data as T;
}

export const account = {
  get token() {
    return read(KEYS.token);
  },

  /** True if this device was told it's too young within the last day. */
  isBlocked(): boolean {
    const until = Number(read(KEYS.blocked) ?? 0);
    return until > Date.now();
  },

  /** Create a guest account with a date of birth (the server checks the age). */
  async createGuest(dob: string): Promise<AccountInfo> {
    try {
      const r = await api<{ token: string; account: AccountInfo }>("/guest", { body: { dob } });
      write(KEYS.token, r.token);
      write(KEYS.dob, dob);
      return r.account;
    } catch (e) {
      if (e instanceof ApiError && e.code === "too_young") write(KEYS.blocked, String(Date.now() + BLOCK_MS));
      throw e;
    }
  },

  /**
   * The server didn't recognise our token (account store reset). Quietly make a
   * new guest with the date of birth we already have; false if we can't.
   */
  async recover(): Promise<boolean> {
    write(KEYS.token, null);
    const dob = read(KEYS.dob);
    if (!dob) return false;
    try {
      await this.createGuest(dob);
      return true;
    } catch {
      return false;
    }
  },

  async saveCode(): Promise<string> {
    const token = this.token;
    if (!token) throw new ApiError(401, "unknown_token");
    return (await api<{ code: string }>("/save-code", { method: "POST", body: {}, token })).code;
  },

  /** Log this device into an existing account with a save code. */
  async loginWithCode(code: string): Promise<void> {
    const r = await api<{ token: string }>("/login", { body: { code } });
    write(KEYS.token, r.token);
  },
};
