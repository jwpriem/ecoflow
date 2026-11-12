import type { H3Event } from 'h3'
import { createError } from 'h3'
import type { Db } from '../db/client'
import type { sites } from '../db/schema'
import { type HueChange, hueCommand, type HueState, hueState } from '../lib/hue'
import {
  type HueAuth,
  hueCreateAppKey,
  type HueCredentials,
  hueDelete,
  HueError,
  hueExchangeCode,
  huePost,
  huePut,
  hueRefresh,
  hueResources,
  hueTokenNeedsRefresh,
} from '../providers/hue'
import { getIntegration, markIntegration, updateIntegration } from './integrations'

type Site = typeof sites.$inferSelect
type Integration = NonNullable<Awaited<ReturnType<typeof getIntegration<HueCredentials>>>>

const CALLBACK_PATH = '/api/integrations/hue/callback'

/** Must be the callback URL of the Remote Hue API app on developers.meethue.com */
export function hueRedirectUri(event: H3Event): string {
  return `${appBaseUrl(event)}${CALLBACK_PATH}`
}

async function load(db: Db, site: Site, key: string): Promise<Integration> {
  const hue = await getIntegration<HueCredentials>(db, site.id, 'hue', key)
  if (!hue) throw createError({ statusCode: 400, statusMessage: 'Connect Philips Hue in Settings first' })
  if (!hue.creds.accessToken || !hue.creds.appKey) throw createError({ statusCode: 400, statusMessage: 'Sign in with Philips Hue in Settings first' })
  return hue
}

/** Drop the tokens: the owner has to sign in again */
async function revoke(db: Db, hue: Integration, key: string, message: string) {
  const { clientId, clientSecret } = hue.creds
  hue.creds = { clientId, clientSecret }
  hue.meta = { ...hue.meta, authorized: false }
  await updateIntegration(db, hue.row.id, { creds: hue.creds, meta: hue.meta }, key)
  await markIntegration(db, hue.row.id, message)
}

const refreshing = new Map<number, Promise<string>>()

async function accessToken(db: Db, hue: Integration, key: string): Promise<string> {
  if (!hueTokenNeedsRefresh(hue.creds.expiresAt)) return hue.creds.accessToken!
  const pending = refreshing.get(hue.row.id)
  if (pending) return pending
  const run = (async () => {
    try {
      const tokens = await hueRefresh(hue.creds)
      hue.creds = { ...hue.creds, ...tokens }
      await updateIntegration(db, hue.row.id, { creds: hue.creds }, key)
      return tokens.accessToken
    } catch (err) {
      if (err instanceof HueError && err.kind === 'auth') await revoke(db, hue, key, 'Philips Hue access expired or was revoked. Sign in with Hue again.')
      throw err
    }
  })().finally(() => refreshing.delete(hue.row.id))
  refreshing.set(hue.row.id, run)
  return run
}

/** Run one call against the bridge; a refused token means the sign-in is gone */
async function withHue<T>(db: Db, site: Site, key: string, fn: (auth: HueAuth) => Promise<T>): Promise<T> {
  const hue = await load(db, site, key)
  const auth = { accessToken: await accessToken(db, hue, key), appKey: hue.creds.appKey! }
  try {
    const out = await fn(auth)
    if (hue.row.status !== 'ok') await markIntegration(db, hue.row.id)
    return out
  } catch (err) {
    if (err instanceof HueError && err.kind === 'auth') await revoke(db, hue, key, 'Philips Hue refused the sign-in. Sign in with Hue again.')
    else if (err instanceof HueError && err.kind !== 'rate') await markIntegration(db, hue.row.id, err.message)
    throw err
  }
}

/** OAuth callback: swap the code for tokens, get the bridge's key for this app and count the lamps */
export async function completeHueAuth(db: Db, site: Site, key: string, code: string) {
  const hue = await getIntegration<HueCredentials>(db, site.id, 'hue', key)
  if (!hue) throw new Error('Save the Hue client ID and secret first')
  const tokens = await hueExchangeCode(hue.creds, code)
  // Keep the key from an earlier sign-in: the bridge would otherwise list WattsWise once per sign-in
  const appKey = hue.creds.appKey ?? (await hueCreateAppKey(tokens.accessToken))
  hue.creds = { clientId: hue.creds.clientId, clientSecret: hue.creds.clientSecret, ...tokens, appKey }
  hue.meta = { ...hue.meta, authorized: true }
  await updateIntegration(db, hue.row.id, { creds: hue.creds, meta: hue.meta }, key)
  let error: string | undefined
  try {
    const lights = await hueResources({ accessToken: tokens.accessToken, appKey }, 'light')
    hue.meta = { ...hue.meta, lights: lights.length }
  } catch (err) {
    // A stale key from before (bridge reset): ask the bridge for a new one
    if (err instanceof HueError && err.kind === 'auth' && hue.creds.appKey) {
      const fresh = await hueCreateAppKey(tokens.accessToken)
      hue.creds = { ...hue.creds, appKey: fresh }
      const lights = await hueResources({ accessToken: tokens.accessToken, appKey: fresh }, 'light')
      hue.meta = { ...hue.meta, lights: lights.length }
    } else error = (err as Error).message
  }
  await updateIntegration(db, hue.row.id, { creds: hue.creds, meta: hue.meta }, key)
  await markIntegration(db, hue.row.id, error)
  return { error }
}

/** Every lamp, room and zone, with what each is doing now */
export function readHue(db: Db, site: Site, key: string): Promise<HueState> {
  return withHue(db, site, key, async (auth) => {
    const [lights, rooms, zones, groupedLights, devices, connectivity] = await Promise.all(
      ['light', 'room', 'zone', 'grouped_light', 'device', 'zigbee_connectivity'].map((t) => hueResources(auth, t)),
    )
    return hueState({ lights: lights!, rooms: rooms!, zones: zones!, groupedLights: groupedLights!, devices: devices!, connectivity: connectivity! })
  })
}

const HUE_ID = /^[0-9a-f-]{36}$/i

function checkId(id: string) {
  if (!HUE_ID.test(id)) throw createError({ statusCode: 400, statusMessage: 'Unknown lamp or group' })
}

function command(change: HueChange) {
  try {
    return hueCommand(change)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
}

/** Switch, dim or colour one lamp */
export function setHueLight(db: Db, site: Site, key: string, id: string, change: HueChange) {
  checkId(id)
  const body = command(change)
  return withHue(db, site, key, (auth) => huePut(auth, 'light', id, body))
}

/** The same for a room or zone at once, through its grouped_light: one call instead of one per lamp */
export function setHueGroup(db: Db, site: Site, key: string, groupedLightId: string, change: HueChange) {
  checkId(groupedLightId)
  const body = command(change)
  return withHue(db, site, key, (auth) => huePut(auth, 'grouped_light', groupedLightId, body))
}

/**
 * A new group, e.g. the six spots in the bookcase. It is made as a Hue zone, so it also shows up in the Hue app and
 * the bridge switches its lamps together.
 */
export function createHueZone(db: Db, site: Site, key: string, name: string, lightIds: string[]) {
  const n = name.trim().slice(0, 32)
  if (!n) throw createError({ statusCode: 400, statusMessage: 'Give the group a name' })
  if (!lightIds.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one lamp' })
  lightIds.forEach(checkId)
  return withHue(db, site, key, async (auth) => {
    const r = await huePost(auth, 'zone', {
      metadata: { name: n, archetype: 'other' },
      children: [...new Set(lightIds)].map((rid) => ({ rid, rtype: 'light' })),
    })
    return { id: r.data[0]?.rid ?? null }
  })
}

/** Change a zone's name and lamps */
export function updateHueZone(db: Db, site: Site, key: string, id: string, patch: { name?: string; lightIds?: string[] }) {
  checkId(id)
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const n = patch.name.trim().slice(0, 32)
    if (!n) throw createError({ statusCode: 400, statusMessage: 'Give the group a name' })
    body.metadata = { name: n }
  }
  if (patch.lightIds) {
    if (!patch.lightIds.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one lamp' })
    patch.lightIds.forEach(checkId)
    body.children = [...new Set(patch.lightIds)].map((rid) => ({ rid, rtype: 'light' }))
  }
  return withHue(db, site, key, (auth) => huePut(auth, 'zone', id, body))
}

/** Remove a zone; the lamps themselves stay */
export function deleteHueZone(db: Db, site: Site, key: string, id: string) {
  checkId(id)
  return withHue(db, site, key, (auth) => hueDelete(auth, 'zone', id))
}

/** Hue errors as HTTP answers the app can show */
export function hueHttpError(err: unknown): never {
  if (err instanceof HueError) throw createError({ statusCode: err.kind === 'rate' ? 429 : 502, statusMessage: err.message })
  throw err
}
