import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  addCredits,
  creditsLeftToday,
  type CreditLedger,
  SE_DAILY_CREDIT_CAP,
  SE_MONTHLY_CREDITS,
  seInWindow,
  seInstant,
  seLocalIso,
  sePollSlot,
  seTokenNeedsRefresh,
} from '../server/lib/solaredgeBudget'
import { signState, verifyState } from '../server/utils/crypto'

const TZ = 'Europe/Amsterdam'
const TOKEN_LIFETIME_MS = 7200 * 1000

/** Run the collector's schedule once a minute, as Nitro does, and count the credits it would spend */
function simulate(start: Date, days: number) {
  const perDay = new Map<string, number>()
  let ledger: CreditLedger | undefined
  let lastSlot = -1
  let expiresAt = 0
  let polls = 0
  let refreshes = 0
  let refused = 0
  for (let t = start.getTime(); t < start.getTime() + days * 86_400_000; t += 60_000) {
    const now = new Date(t)
    if (!seInWindow(now, TZ)) continue
    const slot = sePollSlot(now)
    if (slot === lastSlot) continue
    lastSlot = slot
    const refresh = seTokenNeedsRefresh(expiresAt, now)
    if (creditsLeftToday(ledger, now, TZ) < (refresh ? 2 : 1)) {
      refused++
      continue
    }
    if (refresh) {
      ledger = addCredits(ledger, now, TZ)
      expiresAt = t + TOKEN_LIFETIME_MS
      refreshes++
    }
    ledger = addCredits(ledger, now, TZ)
    polls++
    perDay.set(ledger.day, ledger.dayUsed)
  }
  return { total: polls + refreshes, polls, refreshes, refused, maxPerDay: Math.max(...perDay.values()) }
}

describe('SolarEdge credit budget', () => {
  it('caps a day so that any 31 days stay under 2,000 credits', () => {
    expect(SE_DAILY_CREDIT_CAP * 31).toBeLessThanOrEqual(SE_MONTHLY_CREDITS)
  })

  it('stays under the Free tier for a 31-day month, including a DST change', () => {
    // 2026-10-01 .. 2026-10-31 local time; clocks go back on 25 October
    const r = simulate(new Date('2026-09-30T22:00:00Z'), 31)
    expect(r.polls).toBe(31 * 51) // every 20 minutes from 05:00 to 22:00
    expect(r.maxPerDay).toBeLessThanOrEqual(60)
    expect(r.total).toBeLessThanOrEqual(1860)
    expect(r.total).toBeLessThanOrEqual(SE_MONTHLY_CREDITS)
    expect(r.refused).toBe(0) // the schedule fits without the cap kicking in
  })

  it('stops at the daily cap when extra calls (e.g. reconnecting) used credits', () => {
    const now = new Date('2026-06-21T10:00:00Z')
    let ledger: CreditLedger | undefined
    for (let i = 0; i < SE_DAILY_CREDIT_CAP; i++) ledger = addCredits(ledger, now, TZ)
    expect(creditsLeftToday(ledger, now, TZ)).toBe(0)
    // Next local day starts fresh, the month keeps counting
    const tomorrow = new Date('2026-06-22T04:00:00Z')
    expect(creditsLeftToday(ledger, tomorrow, TZ)).toBe(SE_DAILY_CREDIT_CAP)
    expect(addCredits(ledger, tomorrow, TZ)).toMatchObject({ day: '2026-06-22', dayUsed: 1, month: '2026-06', monthUsed: 65 })
  })

  it('formats API windows as UTC instants', () => {
    expect(seInstant(new Date('2026-10-16T18:51:00.123Z'))).toBe('2026-10-16T18:51:00Z')
  })

  it('formats site-local times without an offset', () => {
    expect(seLocalIso(new Date('2026-07-01T10:15:00Z'), TZ)).toBe('2026-07-01T12:15:00')
    expect(seLocalIso(new Date('2026-12-01T10:15:00Z'), TZ)).toBe('2026-12-01T11:15:00')
  })
})

describe('OAuth state', () => {
  const key = randomBytes(32).toString('base64')
  it('round-trips and rejects tampering or expiry', () => {
    const s = signState({ site: 3 }, key)
    expect(verifyState<{ site: number }>(s, key)?.site).toBe(3)
    const [, mac] = s.split('.')
    const forged = `${Buffer.from(JSON.stringify({ site: 4, exp: Date.now() + 60_000 })).toString('base64url')}.${mac}`
    expect(verifyState(forged, key)).toBeNull()
    expect(verifyState(signState({ site: 3 }, key, -1), key)).toBeNull()
    expect(verifyState(s, randomBytes(32).toString('base64'))).toBeNull()
  })
})
