import type { Db } from '../db/client'
import type { sites, vehicles } from '../db/schema'
import { type AbrpTelemetry, abrpSend } from '../providers/abrp'
import { getIntegration, markIntegration, updateIntegration } from './integrations'
import type { VehicleState } from './zeekr'

type Site = typeof sites.$inferSelect
type Vehicle = typeof vehicles.$inferSelect

/** The app's API key, and per car (vehicles.id) the token from the person's ABRP account. All secret. */
export interface AbrpCredentials {
  apiKey: string
  tokens?: Record<string, string>
}

export interface AbrpCarMeta {
  /** When ABRP last accepted a point for this car */
  lastSentAt?: string
  /** The Zeekr status time of that point: the same status is not sent twice */
  lastStatusAt?: string | null
  lastError?: string | null
  /** The last Zeekr status times sent (ISO), to see how often the car reports while driving */
  updates?: string[]
}

export interface AbrpMeta {
  cars?: Record<string, AbrpCarMeta>
}

/** A car counts as on the move this long after it last moved, so the live reads keep going at a traffic light */
export const LIVE_WINDOW_MS = 10 * 60_000
/** Above this the car is on a DC fast charger (home and AC public chargers stay at or below 22 kW) */
const DC_ABOVE_W = 22_000
const KEEP_UPDATES = 30

/**
 * The Zeekr status time (`updateTime`, epoch ms in practice) as a Date; seconds and ISO strings are understood
 * too. Falls back to `fallback` when there is none or it can't be read.
 */
export function statusTime(statusAt: string | null | undefined, fallback: Date): Date {
  if (!statusAt) return fallback
  const n = Number(statusAt)
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(statusAt)
  return Number.isFinite(d.getTime()) ? d : fallback
}

/** Whether a car is driving or moved in the last minutes: then it is read every minute for ABRP. */
export function isOnTheMove(state: Partial<VehicleState> | null | undefined, now: Date): boolean {
  if (!state || state.pluggedIn) return false
  if (state.driving || (state.speedKmh ?? 0) > 0) return true
  return !!state.movedAt && now.getTime() - new Date(state.movedAt).getTime() < LIVE_WINDOW_MS
}

const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits

/** One ABRP telemetry point from a car's reading. Fields the car doesn't report are left out. */
export function toTelemetry(state: VehicleState, capacityKwh: number | null, now: Date): AbrpTelemetry {
  const t: AbrpTelemetry = { utc: Math.floor(statusTime(state.statusAt, now).getTime() / 1000) }
  const set = <K extends keyof AbrpTelemetry>(k: K, v: AbrpTelemetry[K] | null | undefined) => {
    if (v != null && (typeof v !== 'number' || Number.isFinite(v))) t[k] = v
  }
  const charging = state.charging && state.pluggedIn
  set('soc', state.soc != null ? round(state.soc * 100) : null)
  set('is_charging', charging ? 1 : 0)
  if (charging && state.chargePowerW != null) {
    set('power', -round(state.chargePowerW / 1000, 2))
    set('is_dcfc', state.chargePowerW > DC_ABOVE_W ? 1 : 0)
  }
  const moving = state.driving === true || (state.speedKmh ?? 0) > 0
  set('is_parked', state.pluggedIn || state.driving === false ? 1 : moving ? 0 : null)
  set('speed', state.speedKmh ?? (state.driving === false || state.pluggedIn ? 0 : null))
  set('lat', state.lat)
  set('lon', state.lon)
  set('heading', state.headingDeg)
  set('elevation', state.altitudeM)
  if (capacityKwh) {
    set('capacity', capacityKwh)
    set('soe', state.soc != null ? round(state.soc * capacityKwh, 2) : null)
  }
  set('est_battery_range', state.rangeKm)
  set('odometer', state.odometerKm)
  set('ext_temp', state.extTempC)
  set('cabin_temp', state.cabinTempC)
  if (state.tyresKpa) {
    set('tire_pressure_fl', state.tyresKpa.fl)
    set('tire_pressure_fr', state.tyresKpa.fr)
    set('tire_pressure_rl', state.tyresKpa.rl)
    set('tire_pressure_rr', state.tyresKpa.rr)
  }
  return t
}

/** The ABRP tokens per car (vehicles.id), or null when ABRP isn't connected. */
export async function abrpTokens(db: Db, siteId: number, key: string): Promise<Record<string, string> | null> {
  const integ = await getIntegration<AbrpCredentials>(db, siteId, 'abrp', key)
  if (!integ) return null
  return integ.creds.tokens ?? {}
}

/**
 * Sends the fresh readings of the cars that have an ABRP token. A status ABRP already has (same Zeekr status
 * time) isn't sent again. Never throws: an error is kept per car and on the integration.
 */
export async function pushAbrp(db: Db, site: Site, key: string, cars: { row: Vehicle; state: VehicleState }[], now = new Date()) {
  const integ = await getIntegration<AbrpCredentials>(db, site.id, 'abrp', key)
  if (!integ) return { sent: 0 }
  const tokens = integ.creds.tokens ?? {}
  const meta = (integ.meta ?? {}) as AbrpMeta
  const carsMeta = { ...(meta.cars ?? {}) }
  let sent = 0
  let failure: string | undefined
  for (const { row, state } of cars) {
    const token = tokens[row.id]
    if (!token) continue
    const prev = carsMeta[row.id] ?? {}
    if (state.statusAt && prev.lastStatusAt === state.statusAt && !prev.lastError) continue
    try {
      await abrpSend(integ.creds.apiKey, token, toTelemetry(state, row.capacityKwh, now))
      const at = statusTime(state.statusAt, now).toISOString()
      carsMeta[row.id] = {
        lastSentAt: now.toISOString(),
        lastStatusAt: state.statusAt,
        lastError: null,
        updates: [...(prev.updates ?? []), at].slice(-KEEP_UPDATES),
      }
      sent++
    } catch (err) {
      failure = (err as Error).message
      carsMeta[row.id] = { ...prev, lastError: failure.slice(0, 300) }
    }
  }
  if (!sent && !failure) return { sent }
  await updateIntegration(db, integ.row.id, { meta: { ...meta, cars: carsMeta } as Record<string, unknown> }, key)
  await markIntegration(db, integ.row.id, sent ? undefined : failure)
  return { sent, ...(failure ? { error: failure } : {}) }
}
