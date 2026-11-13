import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import type { Db } from '../db/client'
import type { sites } from '../db/schema'
import { checkOffer, isDeviceId, type NestCamera, nestCameras, NestEventGate, type NestLastRing, nextLastRing, parseNestEvent, withNewline } from '../lib/nest'
import { nestEventMessage } from '../lib/notifications'
import { notify } from './push'
import { ringDoorbell, type SonosLastRing } from './sonos'
import { type NestCredentials, nestCommand, nestDevices, NestError, nestExchangeCode, nestRefresh, nestTokenNeedsRefresh } from '../providers/nest'
import { getIntegration, markIntegration, updateIntegration } from './integrations'

type Site = typeof sites.$inferSelect
type Integration = NonNullable<Awaited<ReturnType<typeof getIntegration<NestCredentials>>>>

const CALLBACK_PATH = '/api/integrations/nest/callback'

/** Must be an authorised redirect URI of the OAuth client in Google Cloud */
export function nestRedirectUri(event: H3Event): string {
  return `${appBaseUrl(event)}${CALLBACK_PATH}`
}

async function load(db: Db, site: Site, key: string): Promise<Integration> {
  const nest = await getIntegration<NestCredentials>(db, site.id, 'nest', key)
  if (!nest) throw createError({ statusCode: 400, statusMessage: 'Connect Google Nest in Settings first' })
  if (!nest.creds.refreshToken) throw createError({ statusCode: 400, statusMessage: 'Sign in with Google in Settings first' })
  return nest
}

/** Drop the tokens: the owner has to sign in again */
async function revoke(db: Db, nest: Integration, key: string, message: string) {
  const { projectId, clientId, clientSecret } = nest.creds
  nest.creds = { projectId, clientId, clientSecret }
  nest.meta = { ...nest.meta, authorized: false }
  await updateIntegration(db, nest.row.id, { creds: nest.creds, meta: nest.meta }, key)
  await markIntegration(db, nest.row.id, message)
}

const refreshing = new Map<number, Promise<string>>()

async function accessToken(db: Db, nest: Integration, key: string): Promise<string> {
  if (!nestTokenNeedsRefresh(nest.creds.expiresAt)) return nest.creds.accessToken!
  const pending = refreshing.get(nest.row.id)
  if (pending) return pending
  const run = (async () => {
    try {
      const tokens = await nestRefresh(nest.creds)
      nest.creds = { ...nest.creds, ...tokens }
      await updateIntegration(db, nest.row.id, { creds: nest.creds }, key)
      return tokens.accessToken
    } catch (err) {
      // Most often: the OAuth app is still in Testing in Google Cloud, where refresh tokens die after 7 days
      if (err instanceof NestError && err.kind === 'auth') await revoke(db, nest, key, 'Google access expired or was revoked. Sign in with Google again.')
      throw err
    }
  })().finally(() => refreshing.delete(nest.row.id))
  refreshing.set(nest.row.id, run)
  return run
}

/** Run one call against SDM; a refused token means the sign-in is gone */
async function withNest<T>(db: Db, site: Site, key: string, fn: (token: string, projectId: string) => Promise<T>): Promise<T> {
  const nest = await load(db, site, key)
  const token = await accessToken(db, nest, key)
  try {
    const out = await fn(token, nest.creds.projectId)
    if (nest.row.status !== 'ok') await markIntegration(db, nest.row.id)
    return out
  } catch (err) {
    if (err instanceof NestError && err.kind === 'auth') await revoke(db, nest, key, 'Google refused the sign-in. Sign in with Google again.')
    // An offline camera or a busy quota says nothing about the connection itself
    else if (err instanceof NestError && err.kind === 'other') await markIntegration(db, nest.row.id, err.message)
    throw err
  }
}

/** OAuth callback: swap the code for tokens, then list the devices, which Google needs to finish the link */
export async function completeNestAuth(db: Db, site: Site, key: string, code: string, redirectUri: string) {
  const nest = await getIntegration<NestCredentials>(db, site.id, 'nest', key)
  if (!nest) throw new Error('Save the Google Nest project ID, client ID and secret first')
  const tokens = await nestExchangeCode(nest.creds, code, redirectUri)
  nest.creds = { projectId: nest.creds.projectId, clientId: nest.creds.clientId, clientSecret: nest.creds.clientSecret, ...tokens }
  nest.meta = { ...nest.meta, authorized: true }
  await updateIntegration(db, nest.row.id, { creds: nest.creds, meta: nest.meta }, key)
  let error: string | undefined
  try {
    const cameras = nestCameras(await nestDevices(tokens.accessToken, nest.creds.projectId))
    nest.meta = { ...nest.meta, cameras: cameras.length, cameraNames: cameraNames(cameras) }
    if (!cameras.length) error = 'Signed in, but no cameras were shared. Sign in again and tick the cameras.'
  } catch (err) {
    error = (err as Error).message
  }
  await updateIntegration(db, nest.row.id, { meta: nest.meta }, key)
  await markIntegration(db, nest.row.id, error)
  return { error }
}

/** The cameras the owner shared with WattsWise */
export function readCameras(db: Db, site: Site, key: string): Promise<NestCamera[]> {
  return withNest(db, site, key, async (token, projectId) => {
    const cameras = nestCameras(await nestDevices(token, projectId))
    await rememberNames(db, site, key, cameras)
    return cameras
  })
}

const cameraNames = (cameras: NestCamera[]) => Object.fromEntries(cameras.map((c) => [c.id, c.name]))

/** The events only carry a device ID: keep the names, so a notification can say "Voordeur" without asking Google */
async function rememberNames(db: Db, site: Site, key: string, cameras: NestCamera[]) {
  const nest = await getIntegration<NestCredentials>(db, site.id, 'nest', key)
  if (!nest) return
  const names = cameraNames(cameras)
  if (JSON.stringify(nest.meta.cameraNames) === JSON.stringify(names) && nest.meta.cameras === cameras.length) return
  await updateIntegration(db, nest.row.id, { meta: { ...nest.meta, cameras: cameras.length, cameraNames: names } }, key)
}

const EVENTS_PATH = '/api/integrations/nest/events'

/** The secret in the push URL: tied to this household and this server's key, so it needs no storage */
export function nestEventsToken(siteId: number, key: string): string {
  return createHmac('sha256', Buffer.from(key, 'base64')).update(`nest-events:${siteId}`).digest('base64url').slice(0, 32)
}

export function checkEventsToken(siteId: number, token: string, key: string): boolean {
  const want = Buffer.from(nestEventsToken(siteId, key))
  const got = Buffer.from(String(token))
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Endpoint URL for the Pub/Sub push subscription in Google Cloud */
export function nestEventsUrl(event: H3Event, siteId: number, key: string): string {
  return `${appBaseUrl(event)}${EVENTS_PATH}?site=${siteId}&token=${nestEventsToken(siteId, key)}`
}

const gate = new NestEventGate()

/**
 * One Pub/Sub push: a ring, person or motion becomes a notification on the devices that want it. A ring also plays
 * the doorbell sound on the Sonos speaker picked in Settings (if any); baseUrl is where that speaker fetches it.
 */
export async function handleNestEvent(db: Db, site: Site, key: string, body: unknown, opts: { now?: number; baseUrl?: string } = {}) {
  const now = opts.now ?? Date.now()
  const ev = parseNestEvent(body)
  const nest = await getIntegration<NestCredentials>(db, site.id, 'nest', key)
  if (!nest) return { notified: null, sent: null, sonos: null }
  const kind = ev ? gate.decide(site.id, ev, now) : null
  let sent: number | null = null
  let failed = 0
  let sonos: SonosLastRing | null = null
  const names = (nest.meta.cameraNames ?? {}) as Record<string, string>
  if (ev && kind) {
    // Started first and not awaited before the push: the kitchen should sound as soon as possible
    const ring = kind === 'chime' && opts.baseUrl ? ringDoorbell(db, site, key, opts.baseUrl, { now }).catch(() => null) : Promise.resolve(null)
    const camera = { id: ev.deviceId, name: names[ev.deviceId] ?? (kind === 'chime' ? 'Voordeur' : 'Camera') }
    const r = await notify(db, site.id, kind === 'chime' ? 'doorbell' : 'camera', nestEventMessage(kind, camera, ev.at, site.timezone))
    sent = r.sent
    failed = r.failed
    sonos = await ring
  }
  // Shown in Settings: what came in last and what became of it, so a missing notification can be explained
  const lastEvent: NestLastEvent = {
    at: new Date(now).toISOString(),
    kinds: ev?.kinds ?? [],
    outcome: !ev ? 'other' : !kind ? 'quiet' : sent ? 'sent' : failed ? 'failed' : 'no-devices',
    sent: sent ?? 0,
  }
  await updateIntegration(db, nest.row.id, { meta: { ...nest.meta, lastEventAt: lastEvent.at, lastEvent, lastRing: nextLastRing(nest.meta.lastRing as NestLastRing | undefined, ev, names) } }, key)
  return { notified: kind, sent, sonos: sonos?.outcome ?? null }
}

/** The last Pub/Sub event: its kinds (empty for a trait update) and whether it became a notification */
export interface NestLastEvent {
  at: string
  kinds: Array<'chime' | 'person' | 'motion'>
  outcome: 'sent' | 'failed' | 'no-devices' | 'quiet' | 'other'
  sent: number
}

function checkId(id: string) {
  if (!isDeviceId(id)) throw createError({ statusCode: 400, statusMessage: 'Unknown camera' })
}

export interface StreamSession {
  answerSdp: string
  mediaSessionId: string
  /** ISO time; the app extends a little before this */
  expiresAt: string
}

/** Start a live stream: the browser's offer goes to the camera, its answer comes back. The video skips our server. */
export function startStream(db: Db, site: Site, key: string, id: string, offerSdp: string): Promise<StreamSession> {
  checkId(id)
  const bad = checkOffer(offerSdp)
  if (bad) throw createError({ statusCode: 400, statusMessage: bad })
  return withNest(db, site, key, async (token, projectId) => {
    const r = await nestCommand<Partial<StreamSession>>(token, projectId, id, 'CameraLiveStream.GenerateWebRtcStream', { offerSdp: withNewline(offerSdp) })
    if (!r.answerSdp || !r.mediaSessionId) throw new NestError('The camera did not answer', 502, 'other')
    return { answerSdp: r.answerSdp, mediaSessionId: r.mediaSessionId, expiresAt: r.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString() }
  })
}

const isSessionId = (s: string) => typeof s === 'string' && s.length > 0 && s.length < 500

/** Another 5 minutes (wired cameras only). The session ID can change, so the app keeps the new one. */
export function extendStream(db: Db, site: Site, key: string, id: string, mediaSessionId: string) {
  checkId(id)
  if (!isSessionId(mediaSessionId)) throw createError({ statusCode: 400, statusMessage: 'Unknown stream' })
  return withNest(db, site, key, async (token, projectId) => {
    const r = await nestCommand<{ mediaSessionId?: string; expiresAt?: string }>(token, projectId, id, 'CameraLiveStream.ExtendWebRtcStream', { mediaSessionId })
    return { mediaSessionId: r.mediaSessionId ?? mediaSessionId, expiresAt: r.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString() }
  })
}

/** Stop watching, so the camera doesn't keep streaming to nobody */
export function stopStream(db: Db, site: Site, key: string, id: string, mediaSessionId: string) {
  checkId(id)
  if (!isSessionId(mediaSessionId)) throw createError({ statusCode: 400, statusMessage: 'Unknown stream' })
  return withNest(db, site, key, (token, projectId) => nestCommand(token, projectId, id, 'CameraLiveStream.StopWebRtcStream', { mediaSessionId }))
}

/** Nest errors as HTTP answers the app can show */
export function nestHttpError(err: unknown): never {
  if (err instanceof NestError) throw createError({ statusCode: err.kind === 'rate' ? 429 : err.kind === 'offline' ? 409 : 502, statusMessage: err.message })
  throw err
}
