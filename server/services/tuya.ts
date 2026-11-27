import type { Db } from '../db/client'
import type { sites } from '../db/schema'
import { type IndoorReading, type TuyaCredentials, TuyaError, type TuyaToken, tuyaReadSensor, tuyaToken } from '../providers/tuya'
import { getIntegration, markIntegration, updateIntegration } from './integrations'

type Site = typeof sites.$inferSelect

export interface Indoor extends IndoorReading {
  at: string
}

/** One token per site, reused until a few minutes before Tuya lets it expire */
const tokens = new Map<number, TuyaToken>()
/** The sensor reports every few minutes; Home refreshes more often than that, so one read per site is shared */
const CACHE_MS = 2 * 60_000
const cache = new Map<number, { at: number; indoor: Promise<Indoor | null> }>()
/** Home doesn't wait longer than this: a slow read fills the cache for the next refresh */
const WAIT_MS = 1500

export function stopTuya(siteId: number) {
  tokens.delete(siteId)
  cache.delete(siteId)
}

async function read(creds: TuyaCredentials, siteId: number): Promise<IndoorReading> {
  const run = async (fresh: boolean) => {
    let t = fresh ? undefined : tokens.get(siteId)
    if (!t || t.expiresAt - Date.now() < 5 * 60_000) tokens.set(siteId, (t = await tuyaToken(creds)))
    return tuyaReadSensor(creds, t)
  }
  return run(false).catch((err) => {
    // A token Tuya no longer takes: get a new one once
    if (err instanceof TuyaError && err.kind === 'auth' && tokens.has(siteId)) {
      tokens.delete(siteId)
      return run(true)
    }
    throw err
  })
}

/**
 * Read the sensor now and record the outcome on the connection. Throws when Tuya refuses or is down.
 * Keeps the sensor's name in meta, for Settings.
 */
export async function readIndoor(db: Db, site: Site, key: string): Promise<Indoor | null> {
  const integ = await getIntegration<TuyaCredentials>(db, site.id, 'tuya', key)
  if (!integ) return null
  try {
    const r = await read(integ.creds, site.id)
    if (integ.row.status !== 'ok') await markIntegration(db, integ.row.id)
    if (integ.meta.sensor !== r.name) await updateIntegration(db, integ.row.id, { meta: { ...integ.meta, sensor: r.name } }, key)
    return { ...r, at: new Date().toISOString() }
  } catch (err) {
    if (err instanceof TuyaError) await markIntegration(db, integ.row.id, err.message)
    throw err
  }
}

/** For Home: the cached reading, or null when there is no sensor, Tuya fails or doesn't answer in time */
export async function currentIndoor(db: Db, site: Site, key: string): Promise<Indoor | null> {
  let hit = cache.get(site.id)
  if (!hit || Date.now() - hit.at >= CACHE_MS) {
    const indoor = readIndoor(db, site, key).catch(() => {
      // A failed read is not kept: the next refresh tries again
      cache.delete(site.id)
      return null
    })
    cache.set(site.id, (hit = { at: Date.now(), indoor }))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), WAIT_MS)))
  return Promise.race([hit.indoor, late]).finally(() => clearTimeout(timer))
}

/** Test the saved connection in Settings: one fresh read */
export async function syncTuya(db: Db, site: Site, key: string): Promise<{ error?: string }> {
  stopTuya(site.id)
  try {
    const r = await readIndoor(db, site, key)
    if (r && r.tempC === null) {
      const integ = await getIntegration(db, site.id, 'tuya', key)
      const error = 'This Tuya device reports no temperature'
      if (integ) await markIntegration(db, integ.row.id, error)
      return { error }
    }
    return {}
  } catch (err) {
    const error = (err as Error).message
    // Network failures and an open circuit breaker aren't marked by readIndoor
    const integ = await getIntegration(db, site.id, 'tuya', key)
    if (integ && !(err instanceof TuyaError)) await markIntegration(db, integ.row.id, error)
    return { error }
  }
}
