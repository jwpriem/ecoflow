import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { vehicleSamples, vehicles, type sites } from '../db/schema'
import { SOLAR_LOCATION } from '../lib/solarForecast'
import {
  type VehicleReading,
  type ZeekrCredentials,
  type ZeekrSession,
  zeekrLogin,
  zeekrVehicleList,
  zeekrVehicleReading,
} from '../providers/zeekr'
import { getIntegration, markIntegration, updateIntegration } from './integrations'
import { pushPluggedCarToTibber, rediscoverTibberApp } from './tibberEv'

type Site = typeof sites.$inferSelect

/** What we keep per car in vehicles.state. SoC/targetSoc 0-1, chargePowerW + while charging. */
export interface VehicleState extends VehicleReading {
  atHome: boolean
  ts: string
  /** Set once the battery level was sent to Tibber for the current plug-in at home */
  tibberSyncedAt?: string
}

/** A car counts as "at home" within this distance of home. */
const HOME_RADIUS_M = 250

interface HomePoint {
  lat: number
  lon: number
}

const live = new Map<number, VehicleState[]>()
export const liveVehicles = (siteId: number) => live.get(siteId)

// One logged-in session per site, reused until a call shows the token has expired.
const sessions = new Map<number, ZeekrSession>()

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Home is the exact point in the Zeekr integration's meta (`home: { lat, lon }`), kept in the
 * database so the address stays out of the repo. Without it, fall back to the town-level solar location.
 */
function homePoint(meta: Record<string, unknown> | null | undefined): HomePoint {
  const home = meta?.home as Partial<HomePoint> | undefined
  if (typeof home?.lat === 'number' && typeof home?.lon === 'number') return { lat: home.lat, lon: home.lon }
  return SOLAR_LOCATION
}

function isAtHome(reading: VehicleReading, home: HomePoint): boolean {
  if (reading.lat == null || reading.lon == null) return false
  return distanceM(reading.lat, reading.lon, home.lat, home.lon) <= HOME_RADIUS_M
}

async function session(siteId: number, creds: ZeekrCredentials, forceLogin = false): Promise<ZeekrSession> {
  const cached = sessions.get(siteId)
  if (cached && !forceLogin) return cached
  const fresh = await zeekrLogin(creds)
  sessions.set(siteId, fresh)
  return fresh
}

async function credentials(db: Db, site: Site, key: string) {
  const integ = await getIntegration<ZeekrCredentials>(db, site.id, 'zeekr', key)
  return integ
}

/**
 * Test the Zeekr sign-in and make sure every car on the account (including shared cars) is a row.
 * Cars are matched on VIN; the name and capacity set in the app are kept on later syncs.
 */
export async function syncZeekrVehicles(db: Db, site: Site, key: string): Promise<{ error?: string; count: number }> {
  const integ = await credentials(db, site, key)
  if (!integ) return { count: 0 }
  try {
    const sess = await zeekrLogin(integ.creds)
    sessions.set(site.id, sess)
    const list = await zeekrVehicleList(integ.creds, sess)
    if (!list.length) throw new Error('No cars on this Zeekr account')
    const existing = await db.select().from(vehicles).where(eq(vehicles.siteId, site.id))
    for (const v of list) {
      if (existing.some((e) => e.vin === v.vin)) continue
      await db.insert(vehicles).values({ siteId: site.id, vin: v.vin, name: v.name, model: v.model })
    }
    const meta = {
      ...integ.meta,
      cars: list.map((v) => ({ vin: v.vin, name: v.name, model: v.model })),
      lastSync: new Date().toISOString(),
    }
    await updateIntegration(db, integ.row.id, { meta }, key)
    await markIntegration(db, integ.row.id)
    return { count: list.length }
  } catch (err) {
    const error = (err as Error).message
    await markIntegration(db, integ.row.id, error)
    return { error, count: 0 }
  }
}

/** Read every car, store a sample and update its state. Safe to call when no cars are configured. */
export async function readZeekrVehicles(db: Db, site: Site, key: string, now = new Date()): Promise<VehicleState[]> {
  const integ = await credentials(db, site, key)
  if (!integ) return []
  const rows = await db.select().from(vehicles).where(eq(vehicles.siteId, site.id))
  if (!rows.length) return []

  const home = homePoint(integ.meta)
  const states: VehicleState[] = []
  let sess: ZeekrSession
  try {
    sess = await session(site.id, integ.creds)
  } catch (err) {
    await markIntegration(db, integ.row.id, (err as Error).message)
    return []
  }

  let failure: string | undefined
  for (const row of rows) {
    try {
      let reading: VehicleReading
      try {
        reading = await zeekrVehicleReading(integ.creds, sess, row.vin)
      } catch {
        // Token likely expired: log in once more and retry this car
        sess = await session(site.id, integ.creds, true)
        reading = await zeekrVehicleReading(integ.creds, sess, row.vin)
      }
      const state: VehicleState = { ...reading, atHome: isAtHome(reading, home), ts: now.toISOString() }
      // Plugged in at home: tell Tibber once per plug-in which car is on the charger and its level
      const prev = (row.state ?? {}) as Partial<VehicleState>
      if (state.atHome && state.pluggedIn && state.soc != null) {
        if (prev.atHome && prev.pluggedIn && prev.tibberSyncedAt) state.tibberSyncedAt = prev.tibberSyncedAt
        else if (await pushPluggedCarToTibber(db, site, key, row, state.soc, state.targetSoc)) state.tibberSyncedAt = now.toISOString()
      }
      states.push(state)
      await db.update(vehicles).set({ state: state as unknown as Record<string, unknown> }).where(eq(vehicles.id, row.id))
      await db.insert(vehicleSamples).values({
        siteId: site.id,
        vehicleId: row.id,
        ts: now,
        soc: reading.soc,
        rangeKm: reading.rangeKm,
        chargePowerW: reading.chargePowerW,
        charging: reading.charging,
        pluggedIn: reading.pluggedIn,
        atHome: state.atHome,
      })
    } catch (err) {
      failure = (err as Error).message
    }
  }

  await rediscoverTibberApp(db, site, key, rows, now).catch(() => undefined)
  live.set(site.id, states)
  await markIntegration(db, integ.row.id, states.length ? undefined : failure)
  return states
}

export function stopZeekr(siteId: number) {
  sessions.delete(siteId)
  live.delete(siteId)
}
