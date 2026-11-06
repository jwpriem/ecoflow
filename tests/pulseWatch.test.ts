import { describe, expect, it } from 'vitest'
import { pulseDownMessage, pulseUpMessage } from '../server/lib/notifications'
import { PULSE_ALERT_AFTER_MS, pulseWatchStep } from '../server/lib/pulseWatch'

const t = (iso: string) => Date.parse(iso)
const MIN = 60_000

describe('Pulse watch', () => {
  const boot = t('2026-11-05T06:00:00Z')

  it('stays quiet while readings come in', () => {
    expect(pulseWatchStep({}, { lastReadingAt: boot + 20 * MIN, watchingSince: boot, lastStoredAt: null }, boot + 20 * MIN + 5000)).toEqual({ kind: 'none' })
  })

  it('reports an outage once readings stopped for the alert time, since the last reading', () => {
    const last = boot + 10 * MIN
    expect(pulseWatchStep({}, { lastReadingAt: last, watchingSince: boot, lastStoredAt: null }, last + PULSE_ALERT_AFTER_MS - 1)).toEqual({ kind: 'none' })
    expect(pulseWatchStep({}, { lastReadingAt: last, watchingSince: boot, lastStoredAt: null }, last + PULSE_ALERT_AFTER_MS)).toEqual({ kind: 'down', since: new Date(last) })
  })

  it('gives a fresh start time before judging, then dates the outage from the last stored reading', () => {
    const stored = t('2026-10-29T07:45:00Z')
    const p = { lastReadingAt: null, watchingSince: boot, lastStoredAt: stored }
    expect(pulseWatchStep({}, p, boot + 5 * MIN)).toEqual({ kind: 'none' })
    expect(pulseWatchStep({}, p, boot + PULSE_ALERT_AFTER_MS)).toEqual({ kind: 'down', since: new Date(stored) })
    expect(pulseWatchStep({}, { ...p, lastStoredAt: null }, boot + PULSE_ALERT_AFTER_MS)).toEqual({ kind: 'down', since: new Date(boot) })
  })

  it('does not repeat the alert, also not after a restart, and reports when readings are back', () => {
    const state = { pulseDownSince: '2026-10-29T07:45:00.000Z' }
    expect(pulseWatchStep(state, { lastReadingAt: null, watchingSince: boot, lastStoredAt: null }, boot + 60 * MIN)).toEqual({ kind: 'none' })
    // An old reading in this process isn't "back"
    expect(pulseWatchStep(state, { lastReadingAt: boot, watchingSince: boot, lastStoredAt: null }, boot + 10 * MIN)).toEqual({ kind: 'none' })
    const back = boot + 61 * MIN
    expect(pulseWatchStep(state, { lastReadingAt: back, watchingSince: boot, lastStoredAt: null }, back + 1000)).toEqual({
      kind: 'up',
      downSince: new Date('2026-10-29T07:45:00Z'),
      downForMs: back - t('2026-10-29T07:45:00Z'),
    })
  })

  it('says since when in the household time zone, with the date when it was another day', () => {
    const now = new Date('2026-11-05T06:30:00Z')
    expect(pulseDownMessage(new Date('2026-11-05T06:10:00Z'), now, 'Europe/Amsterdam')('nl').body).toMatch(/^Sinds 07:10 komen/)
    expect(pulseDownMessage(new Date('2026-10-29T07:45:00Z'), now, 'Europe/Amsterdam')('nl').body).toMatch(/^Sinds 29 okt\.? 08:45 komen/)
    expect(pulseDownMessage(new Date('2026-10-29T07:45:00Z'), now, 'Europe/Amsterdam')('en')).toMatchObject({ title: 'Tibber Pulse sends no data', tag: 'pulse' })
  })

  it('says how long it was gone', () => {
    expect(pulseUpMessage(20 * MIN)('nl').body).toBe('Na 20 min zonder data komen de meterstanden weer binnen.')
    expect(pulseUpMessage(3 * 60 * MIN)('nl').body).toContain('Na 3 uur')
    expect(pulseUpMessage(7 * 24 * 60 * MIN)('en').body).toContain('after 7 days')
  })
})
