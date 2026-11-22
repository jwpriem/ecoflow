import { providerCall } from './http'

/**
 * Open-Meteo (open-meteo.com): free, no key, 15-minute data for Europe from the KNMI and DWD models.
 * We only need global horizontal irradiance; lib/solarForecast.ts turns it into expected production.
 */
const API = 'https://api.open-meteo.com/v1/forecast'

export interface IrradianceSlot {
  /** Start of the 15 minutes the value averages over */
  slotStart: Date
  /** Global horizontal irradiance, W/m² */
  ghi: number
}

/**
 * Past and forecast irradiance per 15 minutes. Open-Meteo labels radiation with the end of the
 * interval it averages ("preceding 15 minutes"), so each value is moved to the start of its slot.
 */
export async function openMeteoIrradiance(lat: number, lon: number, opts: { pastDays: number; forecastDays: number }): Promise<IrradianceSlot[]> {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    minutely_15: 'shortwave_radiation',
    past_days: String(opts.pastDays),
    forecast_days: String(opts.forecastDays),
    timezone: 'GMT',
  })
  const res = await providerCall('openmeteo', (signal) => fetch(`${API}?${qs}`, { headers: { Accept: 'application/json' }, signal }))
  const data = (await res.json().catch(() => ({}))) as { minutely_15?: { time?: string[]; shortwave_radiation?: (number | null)[] }; reason?: string }
  if (!res.ok) throw new Error(`Open-Meteo: ${data.reason ?? `HTTP ${res.status}`}`)
  const time = data.minutely_15?.time ?? []
  const ghi = data.minutely_15?.shortwave_radiation ?? []
  const out: IrradianceSlot[] = []
  time.forEach((t, i) => {
    const v = ghi[i]
    const end = Date.parse(`${t}Z`)
    if (typeof v === 'number' && Number.isFinite(v) && !Number.isNaN(end)) out.push({ slotStart: new Date(end - 15 * 60_000), ghi: Math.max(0, v) })
  })
  return out
}

export interface CurrentWeather {
  /** Air temperature 2 m above ground, °C */
  tempC: number
  /** WMO weather interpretation code (0 clear … 99 thunderstorm with hail) */
  code: number
  /** Model time the values hold for */
  at: Date
}

/** The weather right now at the location: temperature and the WMO weather code, from the same free API */
export async function openMeteoCurrent(lat: number, lon: number, opts: { timeoutMs?: number } = {}): Promise<CurrentWeather | null> {
  const qs = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: 'temperature_2m,weather_code', timezone: 'GMT' })
  const res = await providerCall('openmeteo', (signal) => fetch(`${API}?${qs}`, { headers: { Accept: 'application/json' }, signal }), { retries: 0, timeoutMs: opts.timeoutMs ?? 8000 })
  const data = (await res.json().catch(() => ({}))) as { current?: { time?: string; temperature_2m?: number | null; weather_code?: number | null }; reason?: string }
  if (!res.ok) throw new Error(`Open-Meteo: ${data.reason ?? `HTTP ${res.status}`}`)
  const c = data.current
  if (typeof c?.temperature_2m !== 'number' || !Number.isFinite(c.temperature_2m) || typeof c.weather_code !== 'number') return null
  const at = Date.parse(`${c.time}Z`)
  return { tempC: c.temperature_2m, code: c.weather_code, at: new Date(Number.isNaN(at) ? Date.now() : at) }
}
