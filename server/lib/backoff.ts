/** Waiting before attempt `attempt` (0-based): exponential up to `maxMs`, jittered between half and all of it so many clients spread out. */
export function backoffDelay(attempt: number, { baseMs = 1000, maxMs = 300_000, random = Math.random } = {}): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  return Math.round(ceiling / 2 + (random() * ceiling) / 2)
}

/** A Retry-After header (seconds or an HTTP date) as milliseconds from now, or undefined when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined
  const s = Number(header)
  if (Number.isFinite(s)) return Math.max(0, s * 1000)
  const at = Date.parse(header)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}

/**
 * Stops calling a provider that keeps failing. After `threshold` failures in a row it opens for a cooldown that
 * doubles each time it opens again (up to `maxCooldownMs`); then one call may try, and a success closes it.
 */
export class CircuitBreaker {
  private failures = 0
  private opens = 0
  private openUntil = 0
  private trial = false

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly maxCooldownMs = 300_000,
  ) {}

  /** Milliseconds until a call may go out again; 0 when it may go now. Lets one trial call through after the cooldown. */
  blockedFor(now = Date.now()): number {
    if (this.failures < this.threshold) return 0
    if (now < this.openUntil) return this.openUntil - now
    if (this.trial) return Math.max(1000, this.cooldownMs / 10)
    this.trial = true
    return 0
  }

  success() {
    this.failures = 0
    this.opens = 0
    this.trial = false
  }

  failure(now = Date.now()) {
    this.failures++
    this.trial = false
    if (this.failures >= this.threshold) {
      this.openUntil = now + Math.min(this.maxCooldownMs, this.cooldownMs * 2 ** this.opens++)
    }
  }
}

/** At most `limit` calls per `windowMs`. `take()` waits for a free spot instead of failing. */
export class RateBudget {
  private calls: number[] = []

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Milliseconds until a spot is free, or 0 after taking one */
  tryTake(now = Date.now()): number {
    while (this.calls.length && this.calls[0]! <= now - this.windowMs) this.calls.shift()
    if (this.calls.length < this.limit) {
      this.calls.push(now)
      return 0
    }
    return this.calls[0]! + this.windowMs - now
  }

  async take(sleep: (ms: number) => Promise<void>, now = () => Date.now()) {
    for (let wait = this.tryTake(now()); wait > 0; wait = this.tryTake(now())) await sleep(wait)
  }
}
