import { describe, expect, it } from 'vitest'
import { buildPlan } from '../server/lib/strategy'
import { defaultStrategy } from '../server/lib/types'

const base = new Date('2027-02-01T00:00:00Z')
const slots = (totals: number[]) =>
  totals.map((total, i) => ({ slotStart: new Date(base.getTime() + i * 900_000), total, energy: total / 2, feedIn: total / 2 }))

const input = (totals: number[], storedKwh: number, extra = {}) => ({
  prices: slots(totals),
  storedKwh,
  capacityKwh: 3.84,
  maxChargeW: 2400,
  maxDischargeW: 1600,
  poolAvgCost: 0.1,
  cfg: { ...defaultStrategy, avgLoadW: 800, ...extra },
})

describe('buildPlan', () => {
  it('uses stored energy in the most expensive slots', () => {
    // usable = 0.584 - 0.384 = 0.2 kWh = one slot at 800 W
    const plan = buildPlan(input([0.2, 0.4, 0.3, 0.25], 0.584, { gridCharge: false }))
    expect(plan.map((p) => p.action)).toEqual(['solar_only', 'discharge', 'solar_only', 'solar_only'])
  })

  it('does not discharge below pool cost + spread', () => {
    const plan = buildPlan(input([0.1, 0.11, 0.12], 2, { gridCharge: false }))
    expect(plan.some((p) => p.action === 'discharge')).toBe(false)
  })

  it('charges from the grid in a cheap slot before a peak when the spread pays for losses', () => {
    const plan = buildPlan(input([0.1, 0.3, 0.5], 0.384)) // empty (at reserve)
    expect(plan[0]!.action).toBe('charge_grid')
    expect(plan[0]!.targetW).toBeGreaterThan(0)
    expect(plan[2]!.action).toBe('discharge')
  })

  it('does not arbitrage when losses eat the spread', () => {
    const plan = buildPlan(input([0.3, 0.33], 0.384)) // 0.3/0.85 + 0.03 = 0.383 > 0.33
    expect(plan.some((p) => p.action === 'charge_grid')).toBe(false)
  })

  it('never charges after the peak it serves', () => {
    const plan = buildPlan(input([0.5, 0.1], 0.384))
    expect(plan[1]!.action).not.toBe('charge_grid')
  })

  describe('daily cycle', () => {
    // 96 quarter-hours of one day (UTC midnight = 01:00/02:00 Amsterdam, so use UTC for clean days)
    const day = (fn: (i: number) => number) => Array.from({ length: 96 }, (_, i) => fn(i))
    const flat = day((i) => (i < 24 ? 0.2 : i >= 72 ? 0.24 : 0.22)) // night cheap, evening barely dearer: no arbitrage
    const cycle = (totals: number[], storedKwh: number, extra = {}) =>
      buildPlan({ ...input(totals, storedKwh, { avgLoadW: 450, maxOutputW: 800, dailyCycleKwh: 3.84, ...extra }), timeZone: 'UTC' })
    const discharged = (plan: ReturnType<typeof buildPlan>) => plan.filter((p) => p.action === 'discharge').length * 0.1125

    it('cycles the full usable range even when the spread does not pay', () => {
      expect(buildPlan(input(flat, 0.384, { avgLoadW: 450 })).some((p) => p.action === 'discharge')).toBe(false)
      const plan = cycle(flat, 0.384)
      // usable range 3.84 * (1 - 0.1) = 3.456 kWh at 450 W = 0.1125 kWh per slot -> 30.7 slots
      expect(plan.filter((p) => p.action === 'discharge').length).toBe(31) // the last one runs into reserve
      // charged in the cheap night, discharged in the whole dear evening first
      const firstDis = plan.findIndex((p) => p.action === 'discharge')
      const lastChg = plan.map((p) => p.action).lastIndexOf('charge_grid')
      expect(plan.slice(72).every((p) => p.action === 'discharge')).toBe(true)
      expect(plan.slice(24).some((p) => p.action === 'charge_grid')).toBe(false)
      expect(lastChg).toBeLessThan(firstDis)
    })

    it('stays between reserve and max charge', () => {
      const plan = cycle(flat, 0.384)
      let soc = 0.384
      for (const p of plan) {
        if (p.action === 'charge_grid') soc += ((p.targetW! * 0.25) / 1000) * Math.sqrt(0.85)
        if (p.action === 'discharge') soc -= 0.1125
        expect(soc).toBeGreaterThanOrEqual(0.384 - 0.1125) // the last slot may run into reserve
        expect(soc).toBeLessThanOrEqual(3.84 + 0.01)
      }
    })

    it('uses stored energy first and buys only the rest', () => {
      // stored energy cost above every price, so only the daily cycle discharges it
      const plan = buildPlan({ ...input(flat, 3.84, { avgLoadW: 450, dailyCycleKwh: 3.84 }), poolAvgCost: 0.5, timeZone: 'UTC' })
      expect(plan.some((p) => p.action === 'charge_grid')).toBe(false)
      expect(plan.filter((p) => p.action === 'discharge').length).toBe(31)
    })

    it('discharges no faster than the output limit', () => {
      const plan = buildPlan({ ...input(flat, 3.84, { avgLoadW: 2000, maxOutputW: 800, dailyCycleKwh: 3.84 }), poolAvgCost: 0.5, timeZone: 'UTC' })
      // 800 W = 0.2 kWh per slot -> 3.456 / 0.2 = 17.3 slots
      expect(plan.filter((p) => p.action === 'discharge').length).toBe(18)
    })

    it('counts what was already discharged today', () => {
      const plan = buildPlan({ ...input(flat, 3.84, { avgLoadW: 450, dailyCycleKwh: 3.84 }), poolAvgCost: 0.5, timeZone: 'UTC', dischargedTodayKwh: 3 })
      expect(plan.filter((p) => p.action === 'discharge').length).toBe(5) // (3.456 - 3) / 0.1125 = 4.05 slots
    })

    it('plans each day on its own', () => {
      const plan = cycle([...flat, ...flat], 0.384)
      expect(discharged(plan.slice(0, 96))).toBeGreaterThan(3.456 - 0.06)
      expect(discharged(plan.slice(96))).toBeGreaterThan(3.456 - 0.06)
      // the second day refills in its own cheap night
      expect(plan.slice(96, 120).some((p) => p.action === 'charge_grid')).toBe(true)
    })

    it('never buys dearer than it sells', () => {
      const plan = cycle(day((i) => 0.4 - i * 0.001), 0.384) // prices only fall: nothing cheaper before any slot
      expect(plan.some((p) => p.action !== 'solar_only')).toBe(false)
    })

    it('uses stored energy today and refills it overnight for tomorrow', () => {
      // late evening today, cheap night, dear morning tomorrow (as on 21-22 Oct): today's slots are dearer than the
      // night, so stored energy goes out tonight and the night charge grows to cover tomorrow's peak too
      const t0 = Date.parse('2027-02-01T20:00:00Z')
      const totals = [0.3, 0.29, 0.28, 0.27, ...Array(16).fill(0.2), ...Array(8).fill(0.5)]
      const plan = buildPlan({
        ...input(totals, 1.0, { avgLoadW: 450, dailyCycleKwh: 3.84 }),
        prices: totals.map((total, i) => ({ slotStart: new Date(t0 + i * 900_000), total, energy: 0, feedIn: 0 })),
        poolAvgCost: 0.35,
        timeZone: 'UTC',
        dischargedTodayKwh: 1,
      })
      expect(plan.slice(0, 4).every((p) => p.action === 'discharge')).toBe(true)
      expect(plan.slice(20).every((p) => p.action === 'discharge')).toBe(true)
      expect(plan.slice(4, 20).some((p) => p.action === 'charge_grid')).toBe(true)
    })

    it('is off by default', () => {
      expect(buildPlan(input(flat, 0.384, { avgLoadW: 450 })).some((p) => p.action === 'discharge')).toBe(false)
    })
  })
})
