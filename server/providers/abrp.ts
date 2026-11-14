import { providerCall } from './http'

/**
 * A Better Routeplanner (ABRP) Telemetry API: sends a car's live data so ABRP plans with the real battery level.
 * Docs: documenter.getpostman.com/view/7396339/SWTK5a8w. The API key belongs to the app (made for free at
 * abetterrouteplanner.com/home/app/api-keys/telemetry); the token belongs to one car in the person's ABRP account.
 * All values are metric; `utc` is in seconds.
 */
const BASE = 'https://api.iternio.com/1/tlm/'

export interface AbrpTelemetry {
  utc: number
  soc?: number
  /** kW, positive while driving (out of the battery), negative while charging */
  power?: number
  speed?: number
  lat?: number
  lon?: number
  is_charging?: 0 | 1
  is_dcfc?: 0 | 1
  is_parked?: 0 | 1
  capacity?: number
  soe?: number
  heading?: number
  elevation?: number
  ext_temp?: number
  cabin_temp?: number
  odometer?: number
  est_battery_range?: number
  tire_pressure_fl?: number
  tire_pressure_fr?: number
  tire_pressure_rl?: number
  tire_pressure_rr?: number
}

export class AbrpError extends Error {}

async function call(path: string, apiKey: string, params: Record<string, string>): Promise<Record<string, any>> {
  const res = await providerCall(
    'abrp',
    (signal) =>
      // The key as api_key in the URL: the documented header form (Authorization: APIKEY …) was refused with 401
      // A call without parameters is a plain GET, as in the docs
      Object.keys(params).length
        ? fetch(`${BASE}${path}?${new URLSearchParams({ api_key: apiKey })}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params).toString(),
            signal,
          })
        : fetch(`${BASE}${path}?${new URLSearchParams({ api_key: apiKey })}`, { signal }),
    { retries: 1, timeoutMs: 15_000 },
  )
  const text = await res.text()
  let data: Record<string, any> = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // Not JSON: the status below says enough
  }
  const status = typeof data.status === 'string' ? data.status : undefined
  if (!res.ok || (status && status !== 'ok')) {
    const why = data.error ?? data.message ?? status ?? (text.slice(0, 120) || `HTTP ${res.status}`)
    throw new AbrpError(`ABRP ${path}: ${why}${res.ok ? '' : ` (HTTP ${res.status})`}`)
  }
  return data
}

/** Send one telemetry point for the car behind `token`. Throws AbrpError when ABRP refuses it. */
export async function abrpSend(apiKey: string, token: string, tlm: AbrpTelemetry): Promise<void> {
  await call('send', apiKey, { token, tlm: JSON.stringify(tlm) })
}

/** Checks the API key: the car-model list only needs a valid key. */
export async function abrpCheckKey(apiKey: string): Promise<void> {
  await call('get_carmodels_list', apiKey, {})
}
