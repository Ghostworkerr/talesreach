/**
 * Token-bucket rate limiter, one per connection.
 * Pure and clock-injected so it is easy to test.
 */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number = perSecond,
    now: number = Date.now(),
  ) {
    this.tokens = burst;
    this.last = now;
  }

  /** Returns true if the action is allowed, false if the caller is going too fast. */
  allow(now: number = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.perSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
