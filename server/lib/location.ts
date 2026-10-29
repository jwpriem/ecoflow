import { SOLAR_LOCATION } from './solarForecast'

/**
 * Where a household roughly is, for the solar forecast: rounded to 0.1° (about 10 km), so it is never a
 * home address. Taken from the Tibber home when Tibber is connected, unless the owner set it by hand.
 */
export interface SiteLocation {
  lat: number
  lon: number
  /** A town to show, e.g. Tibber's city */
  place?: string
  source: 'tibber' | 'manual'
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** A coarse location, or null when the input isn't a valid coordinate */
export function coarseLocation(lat: unknown, lon: unknown, source: SiteLocation['source'], place?: string | null): SiteLocation | null {
  const la = Number(lat)
  const lo = Number(lon)
  if (lat === null || lat === '' || lon === null || lon === '' || !Number.isFinite(la) || !Number.isFinite(lo)) return null
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null
  const name = typeof place === 'string' ? place.trim().slice(0, 60) : ''
  return { lat: round1(la), lon: round1(lo), ...(name ? { place: name } : {}), source }
}

/** The household's location for the forecast; households without one keep the original fixed location */
export function forecastLocation(location: SiteLocation | null | undefined): { lat: number; lon: number } {
  return location ? { lat: location.lat, lon: location.lon } : { lat: SOLAR_LOCATION.lat, lon: SOLAR_LOCATION.lon }
}
