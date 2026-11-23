import express, { type Request, type Response, type NextFunction } from "express";
import { GuestRequest, LoginRequest, RateLimiter, ageGroup, formatSaveCode, type AccountInfo } from "@talesreach/shared";
import type { Account } from "../db/store.js";
import { getAccountStore } from "../services.js";

/** Requests per minute per IP address. Logins are stricter (guessing save codes). */
export const DEFAULT_LIMITS = { general: 30, login: 8 };
export type RateLimits = typeof DEFAULT_LIMITS;
const MAX_TRACKED_IPS = 10_000;

function limiter(perMinute: number) {
  const buckets = new Map<string, RateLimiter>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? "unknown";
    let b = buckets.get(ip);
    if (!b) {
      if (buckets.size >= MAX_TRACKED_IPS) buckets.clear();
      b = new RateLimiter(perMinute / 60, perMinute);
      buckets.set(ip, b);
    }
    if (!b.allow()) return res.status(429).json({ error: "too_many_requests" });
    next();
  };
}

/** Bearer token from the Authorization header (never from the URL). */
function bearer(req: Request): string | null {
  const h = req.header("authorization") ?? "";
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(h);
  return m ? m[1]! : null;
}

export function accountInfo(a: Account): AccountInfo {
  const group = ageGroup(a.dob);
  return {
    id: a.id,
    ageGroup: group === "child" ? "minor" : group,
    hasSaveCode: a.saveCodeHash !== null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Account endpoints: guest sign-up (with date of birth), save codes, and "who am I". */
export function accountRoutes(app: express.Application, LIMITS: RateLimits = DEFAULT_LIMITS) {
  const api = express.Router();
  // Small bodies only; anything bigger is refused.
  api.use(express.json({ limit: "1kb" }));
  // The game page lives on another domain; tokens travel in headers, not cookies, so any origin is fine.
  api.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  api.post("/guest", limiter(LIMITS.general), async (req, res) => {
    const parsed = GuestRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
    if (ageGroup(parsed.data.dob) === "child") return res.status(403).json({ error: "too_young" });
    const { account, token } = await getAccountStore().createGuest(parsed.data.dob);
    res.json({ token, account: accountInfo(account) });
  });

  api.post("/login", limiter(LIMITS.login), async (req, res) => {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
    const result = await getAccountStore().loginWithSaveCode(parsed.data.code);
    if (!result) return res.status(401).json({ error: "wrong_code" });
    res.json({ token: result.token, account: accountInfo(result.account) });
  });

  api.post("/save-code", limiter(LIMITS.general), async (req, res) => {
    const token = bearer(req);
    const account = token ? await getAccountStore().byToken(token) : undefined;
    if (!account) return res.status(401).json({ error: "unknown_token" });
    const code = await getAccountStore().rotateSaveCode(account.id);
    res.json({ code: formatSaveCode(code) });
  });

  api.get("/me", limiter(LIMITS.general), async (req, res) => {
    const token = bearer(req);
    const account = token ? await getAccountStore().byToken(token) : undefined;
    if (!account) return res.status(401).json({ error: "unknown_token" });
    res.json({ account: accountInfo(account), name: account.name });
  });

  // Bad JSON and the like: a plain 400, no stack traces.
  api.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: "invalid_request" });
  });

  app.use("/api", api);
}
