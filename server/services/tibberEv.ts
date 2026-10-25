import type { Db } from '../db/client'
import type { sites, vehicles } from '../db/schema'
import {
  type TibberAppCredentials,
  type TibberAppItem,
  tibberAppDiscover,
  tibberAppSetBatteryLevel,
  tibberAppSetChargerVehicle,
} from '../providers/tibberApp'
import { getIntegration, markIntegration, updateIntegration } from './integrations'

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
 * brand (Zeekr 001 -> "001", Zeekr X -> "x"). Returns undefined unless exactly one car matches.
 */
export function matchTibberVehicle(car: { name: string; model: string | null }, options: TibberAppItem[]): string | undefined {
  const words = new Set<string>()
  for (const w of norm(`${car.model ?? ''}`).split(' ')) if (w && w !== 'zeekr') words.add(w)
  const plate = norm(car.name).replace(/ /g, '')
  const hits = options.filter((o) => {
    const n = norm(o.name)
    if (plate && n.replace(/ /g, '').includes(plate)) return true
    const tokens = n.split(' ')
    return words.size > 0 && [...words].every((w) => tokens.includes(w))
  })
  return hits.length === 1 ? hits[0]!.id : undefined
}

/** Sign in, discover the home, cars and charger, and map our cars to Tibber cars where the names match. */
export async function syncTibberApp(db: Db, site: Site, key: string, cars: VehicleRow[]): Promise<{ error?: string }> {
  const integ = await getIntegration<TibberAppCredentials>(db, site.id, 'tibber_app', key)
  if (!integ) return {}
  const meta = (integ.meta ?? {}) as TibberAppMeta
  try {
    const found = await tibberAppDiscover(integ.creds, meta.homeId)
    if (!found.vehicles.length) throw new Error('No cars in the Tibber app: add them under You → Electric cars first')
    const map = { ...(meta.map ?? {}) }
    for (const car of cars) {
      if (map[car.id] && found.vehicles.some((v) => v.id === map[car.id])) continue
      const id = matchTibberVehicle(car, found.vehicles)
      if (id) map[car.id] = id
      else delete map[car.id]
    }
    const chargerId = found.chargers.some((c) => c.id === meta.chargerId) ? meta.chargerId : found.chargers[0]?.id
    const next: TibberAppMeta = { ...meta, homeId: found.homeId, chargerId, vehicles: found.vehicles, chargers: found.chargers, map }
    await updateIntegration(db, integ.row.id, { meta: next as Record<string, unknown> }, key)
    await markIntegration(db, integ.row.id)
    return {}
  } catch (err) {
    const error = (err as Error).message
    await markIntegration(db, integ.row.id, error)
    return { error }
  }
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
