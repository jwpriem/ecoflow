import type { sites } from '../db/schema'
import { forecastLocation } from '../lib/location'
import { type CurrentWeather, openMeteoCurrent } from '../providers/openMeteo'

type Site = typeof sites.$inferSelect

// Open-Meteo updates its current values every 15 minutes; households in the same 0.1° square share one call
const TTL_MS = 10 * 60_000
/** Home doesn't wait longer than this for the weather: a slow call fills the cache for the next refresh */
const WAIT_MS = 1500
const cache = new Map<string, { at: number; weather: Promise<CurrentWeather | null> }>()

export const resetWeatherCache = () => cache.clear()

function currentAt(lat: number, lon: number): Promise<CurrentWeather | null> {
  const key = `${lat},${lon}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.weather
  const weather = openMeteoCurrent(lat, lon).catch(() => {
    // A failed call is not kept: the next refresh tries again
    cache.delete(key)
    return null
  })
  cache.set(key, { at: Date.now(), weather })
  return weather
}

/** The outdoor temperature and weather type for Home, or null when Open-Meteo has no answer in time */
export async function currentWeather(site: Site): Promise<CurrentWeather | null> {
  const { lat, lon } = forecastLocation(site.location)
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), WAIT_MS)))
  return Promise.race([currentAt(lat, lon), late]).finally(() => clearTimeout(timer))
}
