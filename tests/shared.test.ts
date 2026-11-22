import { describe, expect, it } from "vitest";
import { RateLimiter, parseClientMessage } from "@talesreach/shared";

describe("parseClientMessage", () => {
  it("accepts a valid ping", () => {
    expect(parseClientMessage("ping", { n: 5 })).toMatchObject({ ok: true, data: { n: 5 } });
  });

  it("rejects unknown message types", () => {
    expect(parseClientMessage("giveMeGold", { amount: 1e9 }).ok).toBe(false);
    expect(parseClientMessage("__proto__", {}).ok).toBe(false);
    expect(parseClientMessage(42, {}).ok).toBe(false);
  });

  it("rejects garbage payloads", () => {
    for (const bad of [null, undefined, "x", [], { n: -1 }, { n: 1.5 }, { n: "5" }, { n: 1e12 }, { n: 1, extra: true }]) {
      expect(parseClientMessage("ping", bad).ok).toBe(false);
    }
  });
});

describe("RateLimiter", () => {
  it("allows a burst then refuses until time passes", () => {
    const rl = new RateLimiter(10, 10, 0);
    for (let i = 0; i < 10; i++) expect(rl.allow(0)).toBe(true);
    expect(rl.allow(0)).toBe(false);
    expect(rl.allow(200)).toBe(true); // 0.2 s refills 2 tokens
  });
});
