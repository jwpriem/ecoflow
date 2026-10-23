import { describe, expect, it } from 'vitest'
import { bookSolarSlot, seBucketStart, seReadFrom, slotKwh, SOLAR_BACKFILL_MS, SOLAR_SETTLE_MS } from '../server/lib/solar'

const TZ = 'Europe/Amsterdam'
const minutes = (gridW: number[]) => gridW.map((w) => ({ dtSec: 60, gridW: w }))

describe('bookSolarSlot', () => {
  it('splits production into house, grid and batteries', () => {
    // 2 kW average = 0.5 kWh; 5 minutes exporting 1.2 kW = 0.1 kWh; batteries took 0.15 kWh
    const r = bookSolarSlot({ producedKwh: 0.5, grid: minutes([-1200, -1200, -1200, -1200, -1200, 300, 300]), toBatteryKwh: 0.15, priceTotal: 0.3, priceFeedIn: 0.08 })
    expect(r.exportedKwh).toBeCloseTo(0.1)
    expect(r.toBatteryKwh).toBeCloseTo(0.15)
    expect(r.selfUsedKwh).toBeCloseTo(0.25)
    expect(r.valueSelfUsed).toBeCloseTo(0.075)
    expect(r.valueExported).toBeCloseTo(0.008)
    expect(r.valueToBattery).toBeCloseTo(0.012)
  })

  it('ignores import: a cloud and a kettle halfway through the slot do not change the balance', () => {
    const r = bookSolarSlot({ producedKwh: 0.4, grid: minutes([-600, -600, 2000, 2000]), toBatteryKwh: 0, priceTotal: 0.3, priceFeedIn: 0.3 })
    expect(r.exportedKwh).toBeCloseTo(0.02)
    expect(r.selfUsedKwh).toBeCloseTo(0.38)
  })

  it('never books more export or battery charge than was produced', () => {
    const r = bookSolarSlot({ producedKwh: 0.05, grid: minutes(Array(15).fill(-800)), toBatteryKwh: 0.1, priceTotal: 0.3, priceFeedIn: 0.1 })
    expect(r.exportedKwh).toBeCloseTo(0.05)
    expect(r.toBatteryKwh).toBe(0)
    expect(r.selfUsedKwh).toBe(0)
  })

  it('values stored solar at zero when the feed-in price is negative', () => {
    const r = bookSolarSlot({ producedKwh: 0.5, grid: [], toBatteryKwh: 0.5, priceTotal: 0.1, priceFeedIn: -0.05 })
    expect(r.valueToBattery).toBe(0)
  })
})

describe('seBucketStart', () => {
  it('reads instants as they are', () => {
    expect(seBucketStart('2026-10-23T09:15:00Z', TZ)?.toISOString()).toBe('2026-10-23T09:15:00.000Z')
    expect(seBucketStart('2026-10-23T11:15:00+02:00', TZ)?.toISOString()).toBe('2026-10-23T09:15:00.000Z')
  })

  it('reads times without an offset as site-local', () => {
    expect(seBucketStart('2026-10-23 11:15:00', TZ)?.toISOString()).toBe('2026-10-23T09:15:00.000Z')
    expect(seBucketStart('2026-12-01T11:15:00', TZ)?.toISOString()).toBe('2026-12-01T10:15:00.000Z')
  })

  it('rejects garbage', () => {
    expect(seBucketStart('yesterday', TZ)).toBeUndefined()
  })
})

describe('seReadFrom', () => {
  const now = new Date('2026-10-23T12:07:00Z')
  it('rereads the settling window when we are up to date', () => {
    expect(seReadFrom(now, new Date('2026-10-23T11:45:00Z')).getTime()).toBe(new Date('2026-10-23T10:00:00Z').getTime())
    expect(now.getTime() - seReadFrom(now, new Date('2026-10-23T11:45:00Z')).getTime()).toBeLessThanOrEqual(SOLAR_SETTLE_MS + 15 * 60_000)
  })

  it('goes back to the last slot we have after a gap, at most a day', () => {
    expect(seReadFrom(now, new Date('2026-10-23T02:00:00Z')).toISOString()).toBe('2026-10-23T02:00:00.000Z')
    expect(now.getTime() - seReadFrom(now, undefined).getTime()).toBeLessThanOrEqual(SOLAR_BACKFILL_MS + 15 * 60_000)
  })
})

describe('slotKwh', () => {
  it('turns a 15-minute average into energy', () => {
    expect(slotKwh(2000)).toBeCloseTo(0.5)
  })
})
