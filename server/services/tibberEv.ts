import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { integrations, type sites, type vehicles } from '../db/schema'
import { departureAskMessage } from '../lib/notifications'
import {
  type TibberAppCredentials,
  type TibberAppDiscovery,
  type TibberAppItem,
  type TibberAppSetting,
  tibberAppDiscover,
  tibberAppSetBatteryLevel,
  tibberAppSetChargerVehicle,
  tibberAppSetVehicleSettings,
  tibberAppVehicleSettings,
} from '../providers/tibberApp'
import { getIntegration, markIntegration, updateIntegration } from './integrations'
import { notify } from './push'

type Site = typeof sites.$inferSelect
type VehicleRow = typeof vehicles.$inferSelect

/** What tibber_app keeps in its meta: the discovered ids and which Tibber car each of our cars is. */
export interface TibberAppMeta {
  homeId?: string
  chargerId?: string
  vehicles?: TibberAppItem[]
  chargers?: TibberAppItem[]
  /** our vehicles.id -> Tibber vehicle id */
  map?: Record<string, string>
  lastPush?: { vehicleId: number; pct: number; at: string }
  /** our vehicles.id -> the departure last set from WattsWise */
  departures?: Record<string, { day: Weekday; time: string; at: string }>
  debug?: TibberAppDiscovery['debug']
  /** When the cars and charger were last looked up */
  discoveredAt?: string
}

/**
 * The battery level to enter in Tibber. Tibber plans to 100%, so with a charge limit below 100%
 * it asks for the part the car won't charge to be added (limit 80%, at 20% -> enter 40%).
 */
export function tibberBatteryLevel(soc: number, targetSoc: number | null | undefined): number {
  const limit = targetSoc != null && targetSoc > 0 && targetSoc <= 1 ? targetSoc : 1
  return Math.max(0, Math.min(100, Math.round((soc + (1 - limit)) * 100)))
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Finds the Tibber car that is this car by name: the plate or the model words other than the
 * brand (Zeekr 001 -> "001", Zeekr X -> "x"), or the battery size ("100 kWh"). Returns undefined
 * unless exactly one car matches.
 */
export function matchTibberVehicle(car: { name: string; model: string | null; capacityKwh?: number | null }, options: TibberAppItem[]): string | undefined {
  const words = new Set<string>()
  for (const w of norm(`${car.model ?? ''}`).split(' ')) if (w && w !== 'zeekr') words.add(w)
  const plate = norm(car.name).replace(/ /g, '')
  const hits = options.filter((o) => {
    const n = norm(o.name)
    if (plate && n.replace(/ /g, '').includes(plate)) return true
    const tokens = n.split(' ')
    if (car.capacityKwh && n.includes(`${Math.round(car.capacityKwh)} kwh`)) return true
    return words.size > 0 && [...words].every((w) => tokens.includes(w))
  })
  return hits.length === 1 ? hits[0]!.id : undefined
}

/** The home picked for prices in the Tibber (Data API) integration: the same id in the app API. */
async function dataApiHomeId(db: Db, siteId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ meta: integrations.meta })
    .from(integrations)
    .where(and(eq(integrations.siteId, siteId), eq(integrations.provider, 'tibber')))
  const id = row?.meta.homeId
  return typeof id === 'string' ? id : undefined
}

/** Sign in, discover the home, cars and charger, and map our cars to Tibber cars where the names match. */
export async function syncTibberApp(db: Db, site: Site, key: string, cars: VehicleRow[]): Promise<{ error?: string }> {
  const integ = await getIntegration<TibberAppCredentials>(db, site.id, 'tibber_app', key)
  if (!integ) return {}
  const meta: TibberAppMeta = { ...(integ.meta as TibberAppMeta), discoveredAt: new Date().toISOString() }
  try {
    const found = await tibberAppDiscover(integ.creds, meta.homeId ?? (await dataApiHomeId(db, site.id)))
    if (!found.vehicles.length) {
      await updateIntegration(db, integ.row.id, { meta: { ...meta, debug: found.debug } as Record<string, unknown> }, key)
      throw new Error('No cars found in the Tibber app on any home')
    }
    const map = { ...(meta.map ?? {}) }
    for (const car of cars) {
      if (map[car.id] && found.vehicles.some((v) => v.id === map[car.id])) continue
      const id = matchTibberVehicle(car, found.vehicles)
      if (id) map[car.id] = id
      else delete map[car.id]
    }
    const chargerId = found.chargers.some((c) => c.id === meta.chargerId) ? meta.chargerId : found.chargers[0]?.id
    const next: TibberAppMeta = { ...meta, homeId: found.homeId, chargerId, vehicles: found.vehicles, chargers: found.chargers, map, debug: found.debug }
    await updateIntegration(db, integ.row.id, { meta: next as Record<string, unknown> }, key)
    await markIntegration(db, integ.row.id)
    return {}
  } catch (err) {
    const error = (err as Error).message
    await markIntegration(db, integ.row.id, error)
    return { error }
  }
}

/** How often to look again while no cars were found, and while the cars but no charger were found */
const REDISCOVER_MS = 15 * 60 * 1000
const REDISCOVER_CHARGER_MS = 6 * 60 * 60 * 1000

/**
 * While the Tibber app is connected but its cars were not found yet, look again now and then
 * (from the 5-minute car read), so a fix or a car added in the app is picked up without a re-save.
 */
export async function rediscoverTibberApp(db: Db, site: Site, key: string, cars: VehicleRow[], now = new Date()) {
  const integ = await getIntegration<TibberAppCredentials>(db, site.id, 'tibber_app', key)
  if (!integ) return
  const meta = (integ.meta ?? {}) as TibberAppMeta
  const mapped = cars.every((c) => meta.map?.[c.id])
  if (meta.vehicles?.length && meta.chargers?.length && mapped) return
  // Keep looking often while a car is missing or can't be told apart; for a charger only now and then
  const wait = meta.vehicles?.length && mapped ? REDISCOVER_CHARGER_MS : REDISCOVER_MS
  if (meta.discoveredAt && now.getTime() - new Date(meta.discoveredAt).getTime() < wait) return
  await syncTibberApp(db, site, key, cars)
}

/**
 * Called when a car is newly plugged in at home: tell Tibber which car is on the charger and its
 * battery level. Returns true when Tibber accepted both, so the caller can remember it was done.
 */
export async function pushPluggedCarToTibber(
  db: Db,
  site: Site,
  key: string,
  car: VehicleRow,
  soc: number,
  targetSoc: number | null,
): Promise<boolean> {
  const integ = await getIntegration<TibberAppCredentials>(db, site.id, 'tibber_app', key)
  if (!integ) return false
  const meta = (integ.meta ?? {}) as TibberAppMeta
  const vehicleId = meta.map?.[car.id]
  if (!meta.homeId || !vehicleId) return false
  const pct = tibberBatteryLevel(soc, targetSoc)
  try {
    if (meta.chargerId) await tibberAppSetChargerVehicle(integ.creds, meta.homeId, meta.chargerId, vehicleId)
    await tibberAppSetBatteryLevel(integ.creds, meta.homeId, vehicleId, pct)
    const lastPush = { vehicleId: car.id, pct, at: new Date().toISOString() }
    await updateIntegration(db, integ.row.id, { meta: { ...meta, lastPush } as Record<string, unknown> }, key)
    await markIntegration(db, integ.row.id)
    return true
  } catch (err) {
    await markIntegration(db, integ.row.id, (err as Error).message)
    return false
  }
}

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type Weekday = (typeof WEEKDAYS)[number]
export type DepartureSchedule = Record<Weekday, string | null>

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/
export const isDepartureTime = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v)

/**
 * The key of one weekday's departure time. The app namespaces it by how the car was added
 * (`offline.vehicle.` for a car entered by hand, `online.vehicle.smartCharging.` for a connected
 * one), so take the car's own key when it has one.
 */
export function departureKey(settings: TibberAppSetting[], day: Weekday): string {
  const suffix = `departureTimes.${day}`
  return settings.find((s) => s.key.endsWith(suffix))?.key ?? `offline.vehicle.${suffix}`
}

/** The weekly departure schedule ("HH:MM" per weekday, null for no specific departure time). */
export function departureSchedule(settings: TibberAppSetting[]): DepartureSchedule {
  const out = {} as DepartureSchedule
  for (const day of WEEKDAYS) {
    const value = settings.find((s) => s.key === departureKey(settings, day))?.value
    out[day] = isDepartureTime(value) ? value.padStart(5, '0') : null
  }
  return out
}

/**
 * The setting changes that leave only the given day with a departure time: that day first, then a
 * clear for every other day that has one. Without the current settings every other day is cleared.
 */
export function departureChanges(settings: TibberAppSetting[] | null, day: Weekday, time: string): TibberAppSetting[] {
  const now = settings ? departureSchedule(settings) : null
  const changes: TibberAppSetting[] = []
  if (now?.[day] !== time) changes.push({ key: departureKey(settings ?? [], day), value: time })
  for (const d of WEEKDAYS) {
    if (d !== day && (!now || now[d] !== null)) changes.push({ key: departureKey(settings ?? [], d), value: null })
  }
  return changes
}

async function tibberCar(db: Db, site: Site, key: string, carId: number) {
  const integ = await getIntegration<TibberAppCredentials>(db, site.id, 'tibber_app', key)
  if (!integ) throw new Error('Tibber app is not connected')
  const meta = (integ.meta ?? {}) as TibberAppMeta
  const vehicleId = meta.map?.[carId]
  if (!meta.homeId || !vehicleId) throw new Error('This car is not linked to a car in Tibber')
  return { integ, meta, homeId: meta.homeId, vehicleId }
}

/** The car's departure schedule as it is in Tibber now. */
export async function getTibberDeparture(db: Db, site: Site, key: string, carId: number): Promise<DepartureSchedule> {
  const { integ, vehicleId } = await tibberCar(db, site, key, carId)
  return departureSchedule(await tibberAppVehicleSettings(integ.creds, vehicleId))
}

/**
 * Sets the car's departure in Tibber to one day and time, and every other day to "No specific
 * departure time", so Tibber's smart charging plans for this departure only.
 */
export async function setTibberDeparture(db: Db, site: Site, key: string, carId: number, day: Weekday, time: string): Promise<DepartureSchedule> {
  const { integ, meta, homeId, vehicleId } = await tibberCar(db, site, key, carId)
  const current = await tibberAppVehicleSettings(integ.creds, vehicleId).catch(() => null)
  try {
    // One setting per call: the app clears a day with one null per mutation, several nulls in one
    // mutation are accepted but leave the times in place
    for (const change of departureChanges(current, day, time)) {
      await tibberAppSetVehicleSettings(integ.creds, homeId, vehicleId, [change])
    }
  } catch (err) {
    await markIntegration(db, integ.row.id, (err as Error).message)
    throw err
  }
  const departures = { ...(meta.departures ?? {}), [carId]: { day, time, at: new Date().toISOString() } }
  await updateIntegration(db, integ.row.id, { meta: { ...meta, departures } as Record<string, unknown> }, key)
  await markIntegration(db, integ.row.id)
  const after = await tibberAppVehicleSettings(integ.creds, vehicleId).catch(() => null)
  if (after) return departureSchedule(after)
  return Object.fromEntries(WEEKDAYS.map((d) => [d, d === day ? time : null])) as DepartureSchedule
}

/**
 * Called when a car is newly plugged in at home: when it is linked to a car in Tibber, ask on the
 * phone when it has to leave. The notification opens the departure picker on the Cars page.
 */
export async function askDeparture(db: Db, site: Site, key: string, car: VehicleRow) {
  const integ = await getIntegration<TibberAppCredentials>(db, site.id, 'tibber_app', key)
  const meta = (integ?.meta ?? {}) as TibberAppMeta
  if (!meta.homeId || !meta.map?.[car.id]) return
  await notify(db, site.id, 'car', departureAskMessage(car.name, car.id))
}
