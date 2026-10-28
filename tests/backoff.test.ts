import { beforeEach, describe, expect, it } from 'vitest'
import { backoffDelay, CircuitBreaker, RateBudget, retryAfterMs } from '../server/lib/backoff'
import { MQTT_BACKOFF } from '../server/providers/ecoflow/mqtt'
import { providerCall, ProviderUnavailableError, resetProviders } from '../server/providers/http'
import { pool } from '../server/services/jobs'
import { PULSE_BACKOFF, PULSE_STAGGER_MS, staggerDelay } from '../server/providers/tibberPulse'

const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : '{}', { status, headers })
const noSleep = async () => {}

describe('backoff schedule', () => {
  it('doubles up to the cap, jittered between half and all of it', () => {
    const at = (attempt: number, r: number) => backoffDelay(attempt, { ...PULSE_BACKOFF, random: () => r })
    expect([0, 1, 2, 3, 4, 5, 6, 10].map((a) => at(a, 1))).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000])
    expect([0, 1, 2].map((a) => at(a, 0))).toEqual([2_500, 5_000, 10_000])
    expect(backoffDelay(0, { ...MQTT_BACKOFF, random: () => 1 })).toBe(10_000)
  })

  it('reads Retry-After as seconds or as a date', () => {
    const now = Date.parse('2026-10-28T12:00:00Z')
    expect(retryAfterMs('7', now)).toBe(7000)
    expect(retryAfterMs('Wed, 28 Oct 2026 12:00:30 GMT', now)).toBe(30_000)
    expect(retryAfterMs('soon', now)).toBeUndefined()
    expect(retryAfterMs(null, now)).toBeUndefined()
  })
})

describe('circuit breaker', () => {
  it('opens after five failures in a row, lets one call try after the cooldown, and closes on success', () => {
    const b = new CircuitBreaker(5, 30_000)
    for (let i = 0; i < 4; i++) b.failure(0)
    expect(b.blockedFor(0)).toBe(0)
    b.failure(0)
    expect(b.blockedFor(1000)).toBe(29_000)
    // After the cooldown one trial goes, the next waits for its outcome
    expect(b.blockedFor(30_000)).toBe(0)
    expect(b.blockedFor(30_000)).toBeGreaterThan(0)
    // The trial fails: open again for twice as long
    b.failure(30_000)
    expect(b.blockedFor(30_000)).toBe(60_000)
    expect(b.blockedFor(90_000)).toBe(0)
    b.success()
    expect(b.blockedFor(90_000)).toBe(0)
  })
})

describe('rate budget', () => {
  it('allows the limit per window and waits for the oldest call to age out', async () => {
    const budget = new RateBudget(3, 1000)
    expect([0, 1, 2].map((t) => budget.tryTake(t))).toEqual([0, 0, 0])
    expect(budget.tryTake(500)).toBe(500)
    expect(budget.tryTake(1000)).toBe(0)
    let now = 1000
    const waits: number[] = []
    await budget.take(async (ms) => void (waits.push(ms), (now += ms)), () => now)
    expect(waits).toEqual([1])
  })
})

describe('provider calls', () => {
  beforeEach(() => resetProviders())

  it('retries 5xx and network errors with backoff, then returns the answer', async () => {
    const answers: (() => Response)[] = [() => { throw new TypeError('fetch failed') }, () => res(503), () => res(200)]
    const waits: number[] = []
    const r = await providerCall('ecoflow', async () => answers.shift()!(), { sleep: async (ms) => void waits.push(ms), random: () => 1 })
    expect(r.status).toBe(200)
    expect(waits).toEqual([1000, 2000])
  })

  it('honours Retry-After, and gives a long one back to the caller instead of waiting', async () => {
    const waits: number[] = []
    const answers = [res(429, { 'retry-after': '3' }), res(200)]
    expect((await providerCall('openmeteo', async () => answers.shift()!, { sleep: async (ms) => void waits.push(ms) })).status).toBe(200)
    expect(waits).toEqual([3000])
    let calls = 0
    const long = await providerCall('openmeteo', async () => (calls++, res(429, { 'retry-after': '120' })), { sleep: noSleep })
    expect([long.status, calls]).toEqual([429, 1])
  })

  it('does not retry what the caller says not to, or a household’s own 4xx', async () => {
    let calls = 0
    const r = await providerCall('solaredge', async () => (calls++, res(429)), { retryable: (x) => x.status >= 500, sleep: noSleep })
    expect([r.status, calls]).toEqual([429, 1])
    calls = 0
    expect((await providerCall('tibber', async () => (calls++, res(401)), { sleep: noSleep })).status).toBe(401)
    expect(calls).toBe(1)
  })

  it('signs every attempt anew', async () => {
    const nonces: string[] = []
    const answers = [res(502), res(200)]
    let n = 0
    await providerCall('ecoflow', async () => (nonces.push(`nonce-${n++}`), answers.shift()!), { sleep: noSleep })
    expect(nonces).toEqual(['nonce-0', 'nonce-1'])
  })

  it('a provider outage: 200 households hit it a handful of times, not 600', async () => {
    let calls = 0
    const down = async () => (calls++, res(503))
    const outcomes: unknown[] = []
    // Like a job: 8 households at a time
    await pool(Array.from({ length: 200 }, (_, i) => i), 8, async () => {
      outcomes.push(await providerCall('ecoflow', down, { sleep: noSleep }).catch((err: Error) => err))
    })
    // Five failures open the breaker; the calls already under way finish their retries, the rest fail fast
    expect(calls).toBeLessThanOrEqual(8 * 3)
    const failedFast = outcomes.filter((o) => o instanceof ProviderUnavailableError)
    expect(failedFast.length).toBeGreaterThan(190)
    expect((failedFast[0] as Error).message).toMatch(/^EcoFlow is not answering, trying again in \d+ s$/)
  })
})

describe('reconnects', () => {
  it('spreads the first connects of a restart one second apart', () => {
    const now = Date.now() + 10_000_000
    const delays = Array.from({ length: 200 }, () => staggerDelay(now))
    expect(delays[0]).toBe(0)
    expect(delays[199]).toBe(199 * PULSE_STAGGER_MS)
    // Later on, a single household connects right away again
    expect(staggerDelay(now + 1_000_000)).toBe(0)
  })

  it('after an outage, 200 dropped streams come back spread out, not all at once', () => {
    let seed = 42
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    // Third reconnect attempt: between 10 and 20 s
    const delays = Array.from({ length: 200 }, () => backoffDelay(2, { ...PULSE_BACKOFF, random }))
    const perSecond = new Map<number, number>()
    for (const d of delays) perSecond.set(Math.floor(d / 1000), (perSecond.get(Math.floor(d / 1000)) ?? 0) + 1)
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(10_000)
    expect(Math.max(...delays)).toBeLessThanOrEqual(20_000)
    expect(Math.max(...perSecond.values())).toBeLessThan(40)
  })
})
