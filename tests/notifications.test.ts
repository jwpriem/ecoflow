import { describe, expect, it } from 'vitest'
import { dailyMessage, planChangeMessage, pricesMessage } from '../server/lib/notifications'
import type { PlanSlot } from '../server/lib/strategy'

const TZ = 'Europe/Amsterdam'
const at = (iso: string) => new Date(iso)
const slot = (iso: string, action: PlanSlot['action'], price: number): PlanSlot => ({ slotStart: at(iso), action, price, reason: '' })

describe('planChangeMessage', () => {
  const plan = [
    slot('2026-10-16T01:45:00Z', 'solar_only', 0.2),
    slot('2026-10-16T02:00:00Z', 'charge_grid', 0.1),
    slot('2026-10-16T02:15:00Z', 'charge_grid', 0.12),
    slot('2026-10-16T02:30:00Z', 'solar_only', 0.2),
  ]

  it('announces the start of a grid-charge block with its end time and average price', () => {
    const m = planChangeMessage(plan, at('2026-10-16T02:03:00Z'), 'solar_only', TZ)
    expect(m?.title).toBe('Charging from the grid')
    expect(m?.body).toContain('until 04:30') // 02:30Z = 04:30 CEST
    expect(m?.body).toContain('0,11')
  })

  it('stays quiet when the mode did not change or is a quiet mode', () => {
    expect(planChangeMessage(plan, at('2026-10-16T02:20:00Z'), 'charge_grid', TZ)).toBeNull()
    expect(planChangeMessage(plan, at('2026-10-16T02:31:00Z'), 'charge_grid', TZ)).toBeNull()
  })
})

describe('pricesMessage', () => {
  it('names the cheapest and most expensive hour', () => {
    const slots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
      slotStart: new Date(Date.UTC(2026, 9, 17, 0, i * 15)),
      total: i < 4 ? 0.3 : 0.1,
      energy: 0,
      feedIn: 0,
    }))
    const m = pricesMessage(slots, TZ)!
    // Intl puts a non-breaking space after the euro sign
    expect(m.body.replace(/\s/g, ' ')).toBe('Cheapest 03:00 at € 0,10, most expensive 02:00 at € 0,30.')
  })

  it('returns null without prices', () => expect(pricesMessage([], TZ)).toBeNull())
})

describe('dailyMessage', () => {
  it('leaves out parts that are zero', () => {
    const m = dailyMessage({ savingNaive: 0.84, dischargedKwh: 3.21, chargedSolarKwh: 0, chargedGridKwh: 2 })
    expect(m.body).toBe('3.2 kWh used from the batteries, 2.0 kWh bought cheap.')
  })
})
