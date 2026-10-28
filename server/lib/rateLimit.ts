/**
 * Counts attempts per key (an IP or an email) in a fixed window. In memory: right for the one instance the app
 * runs on; with more instances each would count on its own, so the limit becomes per instance.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt. False once the key has used up its attempts for this window. */
  hit(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key)
    if (!h || h.resetAt <= now) {
      if (this.hits.size > 10_000) this.prune(now)
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    h.count++
    return h.count <= this.limit
  }

  /** Forget a key, e.g. after a successful login. */
  reset(key: string) {
    this.hits.delete(key)
  }

  private prune(now: number) {
    for (const [k, h] of this.hits) if (h.resetAt <= now) this.hits.delete(k)
  }
}
