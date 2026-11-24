import { createError } from 'h3'
import type { Db } from '../db/client'
import type { sites } from '../db/schema'
import { AC_MODES, type AcControl, type AcMode, type AcState, isValidTarget } from '../providers/midea/ac'
import { type MideaCredentials, MideaError, type MideaSession, mideaAcSet, mideaAcStatus, mideaAppliances, mideaLogin } from '../providers/midea'
import { ProviderUnavailableError } from '../providers/http'
import { getIntegration, markIntegration, updateIntegration } from './integrations'

type Site = typeof sites.$inferSelect
type Integration = NonNullable<Awaited<ReturnType<typeof getIntegration<MideaCredentials>>>>

/** One air conditioner as the app shows it */
export interface Airco {
  id: string
  name: string
  online: boolean
  state: AcState | null
  /** Why there is no state */
  error?: string
  readAt: string | null
}

export interface AircoChange {
  running?: boolean
  mode?: AcMode
  targetC?: number
  fanSpeed?: number
}

/** Only the air conditioners (0xAC) on the account */
const AC_TYPE = '0xAC'

/**
 * One login per site, kept in memory: Midea counts signed-in devices per account and refuses new ones over its
 * limit, so a session is reused until Midea says it has expired.
 */
const sessions = new Map<number, MideaSession>()
/** The last read per site, so opening the page twice doesn't ask the unit twice */
const cache = new Map<number, { at: number; aircos: Airco[] }>()
const CACHE_MS = 30_000

export function stopMidea(siteId: number) {
  sessions.delete(siteId)
  cache.delete(siteId)
}

async function load(db: Db, site: Site, key: string): Promise<Integration> {
  const integ = await getIntegration<MideaCredentials>(db, site.id, 'midea', key)
  if (!integ) throw createError({ statusCode: 400, statusMessage: 'Connect Midea in Settings first' })
  return integ
}

/** Run calls with the site's session; log in again once when Midea says the session is gone */
async function withSession<T>(db: Db, integ: Integration, siteId: number, fn: (s: MideaSession) => Promise<T>): Promise<T> {
  const run = async (fresh: boolean) => {
    let s = fresh ? undefined : sessions.get(siteId)
    if (!s) sessions.set(siteId, (s = await mideaLogin(integ.creds)))
    return fn(s)
  }
  try {
    const out = await run(false).catch((err) => {
      if (err instanceof MideaError && err.kind === 'session') return run(true)
      throw err
    })
    if (integ.row.status !== 'ok') await markIntegration(db, integ.row.id)
    return out
  } catch (err) {
    if (err instanceof MideaError && err.kind !== 'other') {
      sessions.delete(siteId)
      await markIntegration(db, integ.row.id, err.message)
    }
    throw err
  }
}

/**
 * Sign in, list the air conditioners on the account and read each one. Used when the owner saves the sign-in
 * and when the page asks for fresh values.
 */
export async function readAircos(db: Db, site: Site, key: string, opts: { fresh?: boolean; relogin?: boolean } = {}): Promise<Airco[]> {
  const hit = cache.get(site.id)
  if (hit && !opts.fresh && Date.now() - hit.at < CACHE_MS) return hit.aircos
  const integ = await load(db, site, key)
  if (opts.relogin) sessions.delete(site.id)
  const aircos = await withSession(db, integ, site.id, async (s) => {
    const list = (await mideaAppliances(s)).filter((a) => a.type === AC_TYPE)
    const out: Airco[] = []
    for (const a of list) {
      try {
        out.push({ id: a.id, name: a.name, online: a.online, state: await mideaAcStatus(s, a.id), readAt: new Date().toISOString() })
      } catch (err) {
        // A session error is the account's, not this unit's: let withSession log in again
        if (err instanceof MideaError && err.kind !== 'other') throw err
        out.push({ id: a.id, name: a.name, online: a.online, state: null, error: (err as Error).message, readAt: null })
      }
    }
    return out
  })
  cache.set(site.id, { at: Date.now(), aircos })
  const names = aircos.map((a) => ({ id: a.id, name: a.name }))
  if (JSON.stringify(integ.meta.aircos ?? null) !== JSON.stringify(names)) await updateIntegration(db, integ.row.id, { meta: { ...integ.meta, aircos: names } }, key)
  return aircos
}

/** Checks a change from the app; throws a 400 for anything off */
export function parseAircoChange(body: unknown): AircoChange {
  const b = (body ?? {}) as Record<string, unknown>
  const out: AircoChange = {}
  if (b.running !== undefined) {
    if (typeof b.running !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'running must be true or false' })
    out.running = b.running
  }
  if (b.mode !== undefined) {
    if (!AC_MODES.includes(b.mode as AcMode)) throw createError({ statusCode: 400, statusMessage: 'Unknown mode' })
    out.mode = b.mode as AcMode
  }
  if (b.targetC !== undefined) {
    if (typeof b.targetC !== 'number' || !isValidTarget(b.targetC)) throw createError({ statusCode: 400, statusMessage: 'Temperature must be 16-30 °C in steps of 0.5' })
    out.targetC = b.targetC
  }
  if (b.fanSpeed !== undefined) {
    const f = b.fanSpeed
    if (typeof f !== 'number' || !Number.isInteger(f) || !((f >= 1 && f <= 100) || f === 102)) throw createError({ statusCode: 400, statusMessage: 'Fan speed must be 1-100 or 102 (auto)' })
    out.fanSpeed = f
  }
  if (!Object.keys(out).length) throw createError({ statusCode: 400, statusMessage: 'Nothing to change' })
  return out
}

/** The full command for a change: the unit's current settings with the change on top */
export function controlFor(state: AcState, change: AircoChange): AcControl {
  return {
    running: change.running ?? state.running,
    mode: change.mode ?? state.mode ?? 'auto',
    targetC: change.targetC ?? Math.min(30, Math.max(16, state.targetC)),
    fanSpeed: change.fanSpeed ?? state.fanSpeed,
    eco: state.eco,
    turbo: state.turbo,
    swing: state.swing,
    purifier: state.purifier,
    dryer: state.dryer,
    frostProtect: state.frostProtect,
    comfortMode: state.comfortMode,
    comfortSleep: state.comfortSleep,
  }
}

/** Change one air conditioner. Reads it first, because the command sets everything at once. */
export async function setAirco(db: Db, site: Site, key: string, id: string, change: AircoChange): Promise<Airco> {
  const integ = await load(db, site, key)
  const known = (integ.meta.aircos as { id: string; name: string }[] | undefined) ?? []
  const meta = known.find((a) => a.id === id)
  if (!meta) throw createError({ statusCode: 404, statusMessage: 'Unknown air conditioner' })
  const state = await withSession(db, integ, site.id, async (s) => mideaAcSet(s, id, controlFor(await mideaAcStatus(s, id), change)))
  const airco: Airco = { id, name: meta.name, online: true, state, readAt: new Date().toISOString() }
  const hit = cache.get(site.id)
  if (hit) hit.aircos = hit.aircos.map((a) => (a.id === id ? airco : a))
  return airco
}

/** Sign in and list the units, for saving the connection in Settings */
export async function syncMidea(db: Db, site: Site, key: string): Promise<{ error?: string; count: number }> {
  try {
    const aircos = await readAircos(db, site, key, { fresh: true, relogin: true })
    if (!aircos.length) throw new Error('No air conditioner on this Midea account')
    const integ = await load(db, site, key)
    await markIntegration(db, integ.row.id)
    return { count: aircos.length }
  } catch (err) {
    const error = (err as { statusMessage?: string }).statusMessage ?? (err as Error).message
    const integ = await getIntegration(db, site.id, 'midea', key)
    if (integ) await markIntegration(db, integ.row.id, error)
    return { error, count: 0 }
  }
}

/** Errors from Midea as HTTP answers for the app */
export function mideaHttpError(err: unknown): never {
  if (err instanceof MideaError) throw createError({ statusCode: err.kind === 'other' ? 502 : 409, statusMessage: err.message })
  if (err instanceof ProviderUnavailableError) throw createError({ statusCode: 503, statusMessage: err.message })
  throw err
}
