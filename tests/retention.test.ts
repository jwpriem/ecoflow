import { describe, expect, it } from 'vitest'
import { isThinned, RAW_DAYS, thinUntil } from '../server/lib/retention'

const DAY_MS = 86_400_000
const now = new Date('2026-12-30T02:40:00Z')

describe('thinUntil', () => {
  it('keeps the last RAW_DAYS of minutes, cut on a day boundary', () => {
    const until = thinUntil(now, [now])
    expect(until.toISOString()).toBe('2026-10-31T00:00:00.000Z')
    expect(now.getTime() - until.getTime()).toBeGreaterThanOrEqual(RAW_DAYS * DAY_MS)
  })

  it('never thins minutes the battery ledger has not booked yet', () => {
    // A battery whose ledger stalled on 20 October keeps its minutes from the day before on
    const until = thinUntil(now, [now, new Date('2026-10-20T13:15:00Z')])
    expect(until.toISOString()).toBe('2026-10-19T00:00:00.000Z')
  })
})

describe('isThinned', () => {
  it('tells averaged rows from minute samples', () => {
    expect(isThinned(new Date('2026-10-20T13:15:00.000Z'))).toBe(true)
    expect(isThinned(new Date('2026-10-20T13:16:00.210Z'))).toBe(false)
  })
})
