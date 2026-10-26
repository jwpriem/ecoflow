import { describe, expect, it } from 'vitest'
import { attribute, bookSlot } from '../server/lib/ledger'

const minute = (batteryW: number, gridW: number, totalChargeW = Math.max(0, batteryW), pvW = 0) => ({ dtSec: 60, batteryW, gridW, totalChargeW, pvW })
const empty = { kwh: 0, costNaive: 0, costOpportunity: 0 }

describe('attribute', () => {
  it('counts charging while exporting as solar', () => {
    // 15 min at 1000 W charge while still exporting 200 W
    const r = attribute(Array.from({ length: 15 }, () => minute(1000, -200)))
    expect(r.solar).toBeCloseTo(0.25)
    expect(r.grid).toBe(0)
  })

  it('counts the imported part as grid', () => {
    // charging 1000 W, meter shows 400 W import -> 400 W came from the grid
    const r = attribute(Array.from({ length: 15 }, () => minute(1000, 400)))
    expect(r.grid).toBeCloseTo(0.1)
    expect(r.solar).toBeCloseTo(0.15)
  })

  it('splits grid import over two batteries by their charge power', () => {
    const a = attribute([minute(600, 500, 1000)])
    const b = attribute([minute(400, 500, 1000)])
    expect(a.grid / b.grid).toBeCloseTo(1.5)
    expect(a.grid + b.grid).toBeCloseTo((500 * 60) / 3.6e6)
  })

  it('counts direct PV as solar and discharge separately', () => {
    const r = attribute([minute(-500, 0, 0, 300)])
    expect(r.solar).toBeCloseTo((300 * 60) / 3.6e6)
    expect(r.discharged).toBeCloseTo((500 * 60) / 3.6e6)
  })
})

describe('bookSlot', () => {
  it('values solar at 0 (naive) and at feed-in (opportunity)', () => {
    const r = bookSlot({ pool: empty, samples: Array.from({ length: 60 }, () => minute(1000, -100)), priceTotal: 0.2, priceFeedIn: 0.08 })
    expect(r.chargedSolarKwh).toBeCloseTo(1)
    expect(r.costNaive).toBe(0)
    expect(r.costOpportunity).toBeCloseTo(0.08)
    expect(r.pool.kwh).toBeCloseTo(1)
  })

  it('books savings on discharge against the pool average cost', () => {
    const pool = { kwh: 2, costNaive: 0.2, costOpportunity: 0.3 } // 0.10 / 0.15 per kWh
    const r = bookSlot({ pool, samples: Array.from({ length: 60 }, () => minute(-1000, 0, 0)), priceTotal: 0.4, priceFeedIn: 0.1 })
    expect(r.dischargedKwh).toBeCloseTo(1)
    expect(r.valueDischarged).toBeCloseTo(0.4)
    expect(r.savingNaive).toBeCloseTo(0.3)
    expect(r.savingOpportunity).toBeCloseTo(0.25)
    expect(r.pool.kwh).toBeCloseTo(1)
    expect(r.pool.costNaive).toBeCloseTo(0.1)
  })

  it('reconciles to measured SoC: losses keep their cost', () => {
    const r = bookSlot({ pool: { kwh: 1, costNaive: 0.1, costOpportunity: 0.1 }, samples: [], priceTotal: 0.3, priceFeedIn: 0.3, measuredKwh: 0.9 })
    expect(r.lossKwh).toBeCloseTo(0.1)
    expect(r.pool.kwh).toBeCloseTo(0.9)
    expect(r.pool.costNaive).toBeCloseTo(0.1) // now 0.111/kWh
  })

  it('books SoC noise as signed loss so it cancels out', () => {
    let pool = { kwh: 1, costNaive: 0, costOpportunity: 0 }
    const a = bookSlot({ pool, samples: [], priceTotal: 0.3, priceFeedIn: 0.3, measuredKwh: 0.98 })
    pool = a.pool
    const b = bookSlot({ pool, samples: [], priceTotal: 0.3, priceFeedIn: 0.3, measuredKwh: 1 })
    expect(a.lossKwh).toBeCloseTo(0.02)
    expect(b.lossKwh).toBeCloseTo(-0.02)
    expect(a.lossKwh + b.lossKwh).toBeCloseTo(0)
  })
})
