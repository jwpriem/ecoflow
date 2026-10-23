/**
 * Expected solar production from the irradiance forecast.
 *
 * Production is roughly proportional to irradiance; the factor (W of production per W/m²) covers panel
 * area, orientation and losses. It is fitted on our own SolarEdge history against the irradiance Open-Meteo
 * measured for the same quarters, so it improves as history builds up. Until there is enough history it
 * starts from the system's peak power at 75% performance (9.36 kWp -> 7 W per W/m²).
 */

/** The house; the app has one site, so the location lives here and in app/utils/sun.ts */
export const SOLAR_LOCATION = { name: 'Waddinxveen', lat: 52.035, lon: 4.651 } as const
export const FORECAST_PAST_DAYS = 14
export const FORECAST_DAYS = 3
/** Quarters with less light than this say more about shading and dawn than about the factor */
const MIN_GHI = 50
/** Fit only with this many good quarters, about two days of daylight */
const MIN_PAIRS = 40
const DEFAULT_PERFORMANCE = 0.75

export function defaultFactor(peakPowerKw: number | undefined): number {
  return (peakPowerKw && peakPowerKw > 0 ? peakPowerKw : 4) * DEFAULT_PERFORMANCE
}

/** Least squares through zero: W produced per W/m² */
export function fitFactor(pairs: { ghi: number; w: number }[], fallback: number): { factor: number; pairs: number } {
  const good = pairs.filter((p) => p.ghi >= MIN_GHI && p.w >= 0)
  if (good.length < MIN_PAIRS) return { factor: fallback, pairs: good.length }
  let xy = 0
  let xx = 0
  for (const p of good) {
    xy += p.ghi * p.w
    xx += p.ghi * p.ghi
  }
  return { factor: xx > 0 ? xy / xx : fallback, pairs: good.length }
}

/** Expected production in W, capped at the system's peak power */
export function expectedSolarW(ghi: number, factor: number, peakPowerKw?: number): number {
  const w = Math.max(0, ghi * factor)
  return peakPowerKw && peakPowerKw > 0 ? Math.min(w, peakPowerKw * 1000) : w
}
