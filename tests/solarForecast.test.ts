import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultFactor, expectedSolarW, fitFactor } from '../server/lib/solarForecast'
import { openMeteoIrradiance } from '../server/providers/openMeteo'

describe('fitFactor', () => {
  it('falls back to peak power until there is enough history', () => {
    expect(fitFactor([{ ghi: 500, w: 4000 }], defaultFactor(9.36))).toEqual({ factor: 9.36 * 0.75, pairs: 1 })
  })

  it('fits W per W/m² on good quarters and ignores dawn', () => {
    const pairs = Array.from({ length: 60 }, (_, i) => ({ ghi: 100 + i * 10, w: (100 + i * 10) * 6 }))
    pairs.push({ ghi: 10, w: 900 })
    expect(fitFactor(pairs, 7).factor).toBeCloseTo(6)
  })
})

describe('expectedSolarW', () => {
  it('caps at the peak power', () => {
    expect(expectedSolarW(1000, 12, 9.36)).toBe(9360)
    expect(expectedSolarW(100, 7, 9.36)).toBe(700)
  })
})

describe('openMeteoIrradiance', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('moves each value to the start of the quarter it averages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      minutely_15: { time: ['2026-10-23T10:00', '2026-10-23T10:15'], shortwave_radiation: [300, null] },
    }))))
    const rows = await openMeteoIrradiance(52, 4.6, { pastDays: 1, forecastDays: 1 })
    expect(rows).toEqual([{ slotStart: new Date('2026-10-23T09:45:00Z'), ghi: 300 }])
  })
})
