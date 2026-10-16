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
})
