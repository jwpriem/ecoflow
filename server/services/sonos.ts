import type { H3Event } from 'h3'
import { createError } from 'h3'
import type { Db } from '../db/client'
import type { sites } from '../db/schema'
import {
  DOORBELL_SOUND_PATH,
  DOORBELL_SOUNDS,
  type DoorbellSettings,
  doorbellSettings,
  type DoorbellSound,
  findSpeaker,
  isPlayerId,
  type SonosSpeaker,
  sonosSpeakers,
} from '../lib/sonos'
import {
  type SonosAuth,
  sonosAudioClip,
  type SonosCredentials,
  SonosError,
  sonosExchangeCode,
  sonosHouseholds,
  sonosPlayersOf,
  sonosRefresh,
  sonosTokenNeedsRefresh,
} from '../providers/sonos'
import { getIntegration, markIntegration, updateIntegration } from './integrations'

type Site = typeof sites.$inferSelect
type Integration = NonNullable<Awaited<ReturnType<typeof getIntegration<SonosCredentials>>>>

const CALLBACK_PATH = '/api/integrations/sonos/callback'

/** Must be a redirect URI of the control integration's key on developer.sonos.com */
export function sonosRedirectUri(event: H3Event): string {
  return `${appBaseUrl(event)}${CALLBACK_PATH}`
}

async function load(db: Db, site: Site, key: string): Promise<Integration> {
  const sonos = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
  if (!sonos) throw createError({ statusCode: 400, statusMessage: 'Connect Sonos in Settings first' })
  if (!sonos.creds.refreshToken) throw createError({ statusCode: 400, statusMessage: 'Sign in with Sonos in Settings first' })
  return sonos
}

/** Drop the tokens: the owner has to sign in again. The doorbell settings stay. */
async function revoke(db: Db, sonos: Integration, key: string, message: string) {
  const { clientId, clientSecret } = sonos.creds
  sonos.creds = { clientId, clientSecret }
  sonos.meta = { ...sonos.meta, authorized: false }
  await updateIntegration(db, sonos.row.id, { creds: sonos.creds, meta: sonos.meta }, key)
  await markIntegration(db, sonos.row.id, message)
}

const refreshing = new Map<number, Promise<string>>()

async function accessToken(db: Db, sonos: Integration, key: string): Promise<string> {
  if (!sonosTokenNeedsRefresh(sonos.creds.expiresAt)) return sonos.creds.accessToken!
  const pending = refreshing.get(sonos.row.id)
  if (pending) return pending
  const run = (async () => {
    try {
      const tokens = await sonosRefresh(sonos.creds)
      sonos.creds = { ...sonos.creds, ...tokens }
      await updateIntegration(db, sonos.row.id, { creds: sonos.creds }, key)
      return tokens.accessToken
    } catch (err) {
      if (err instanceof SonosError && err.kind === 'auth') await revoke(db, sonos, key, 'Sonos access expired or was revoked. Sign in with Sonos again.')
      throw err
    }
  })().finally(() => refreshing.delete(sonos.row.id))
  refreshing.set(sonos.row.id, run)
  return run
}

/** Run calls against Sonos; a refused token means the sign-in is gone */
async function withSonos<T>(db: Db, site: Site, key: string, fn: (auth: SonosAuth, sonos: Integration) => Promise<T>): Promise<T> {
  const sonos = await load(db, site, key)
  const auth = { accessToken: await accessToken(db, sonos, key), clientId: sonos.creds.clientId }
  try {
    const out = await fn(auth, sonos)
    if (sonos.row.status !== 'ok') await markIntegration(db, sonos.row.id)
    return out
  } catch (err) {
    if (err instanceof SonosError && err.kind === 'auth') await revoke(db, sonos, key, 'Sonos refused the sign-in. Sign in with Sonos again.')
    // A sleeping or unplugged speaker says nothing about the connection itself
    else if (err instanceof SonosError && err.kind === 'other' && err.status < 500) await markIntegration(db, sonos.row.id, err.message)
    throw err
  }
}

async function listSpeakers(auth: SonosAuth): Promise<SonosSpeaker[]> {
  const ids = await sonosHouseholds(auth)
  const households = await Promise.all(ids.map(async (id) => ({ id, players: await sonosPlayersOf(auth, id) })))
  return sonosSpeakers(households)
}

/** OAuth callback: swap the code for tokens and list the speakers to pick from */
export async function completeSonosAuth(db: Db, site: Site, key: string, code: string, redirectUri: string) {
  const sonos = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
  if (!sonos) throw new Error('Save the Sonos key and secret first')
  const tokens = await sonosExchangeCode(sonos.creds, code, redirectUri)
  sonos.creds = { clientId: sonos.creds.clientId, clientSecret: sonos.creds.clientSecret, ...tokens }
  sonos.meta = { ...sonos.meta, authorized: true }
  await updateIntegration(db, sonos.row.id, { creds: sonos.creds, meta: sonos.meta }, key)
  let error: string | undefined
  try {
    const speakers = await listSpeakers({ accessToken: tokens.accessToken, clientId: sonos.creds.clientId })
    sonos.meta = { ...sonos.meta, speakers }
    if (!speakers.length) error = 'Signed in, but there are no speakers on this Sonos account'
  } catch (err) {
    error = (err as Error).message
  }
  await updateIntegration(db, sonos.row.id, { meta: sonos.meta }, key)
  await markIntegration(db, sonos.row.id, error)
  return { error }
}

/** The speakers now, also stored so Settings can show them without asking Sonos */
export function readSpeakers(db: Db, site: Site, key: string): Promise<SonosSpeaker[]> {
  return withSonos(db, site, key, async (auth, sonos) => {
    const speakers = await listSpeakers(auth)
    await updateIntegration(db, sonos.row.id, { meta: { ...sonos.meta, speakers } }, key)
    return speakers
  })
}

/** Change what the doorbell does on Sonos. The speaker must be one we listed and able to play a clip. */
export async function saveDoorbell(db: Db, site: Site, key: string, patch: Partial<DoorbellSettings>): Promise<DoorbellSettings> {
  const sonos = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
  if (!sonos) throw createError({ statusCode: 400, statusMessage: 'Connect Sonos in Settings first' })
  const cur = doorbellSettings(sonos.meta)
  const next: DoorbellSettings = { ...cur }
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true
  if (patch.volume !== undefined) {
    const v = Number(patch.volume)
    if (!Number.isFinite(v)) throw createError({ statusCode: 400, statusMessage: 'Volume must be a number' })
    next.volume = Math.round(Math.min(100, Math.max(5, v)))
  }
  if (patch.sound !== undefined) {
    if (!DOORBELL_SOUNDS.includes(patch.sound as DoorbellSound)) throw createError({ statusCode: 400, statusMessage: 'Unknown sound' })
    next.sound = patch.sound as DoorbellSound
  }
  if (patch.playerId !== undefined) {
    if (patch.playerId === null) Object.assign(next, { playerId: null, playerName: null })
    else {
      if (!isPlayerId(patch.playerId)) throw createError({ statusCode: 400, statusMessage: 'Unknown speaker' })
      const speakers = (sonos.meta.speakers ?? []) as SonosSpeaker[]
      const sp = speakers.find((s) => s.id === patch.playerId)
      if (!sp) throw createError({ statusCode: 400, statusMessage: 'Unknown speaker' })
      if (!sp.audioClip) throw createError({ statusCode: 400, statusMessage: 'This speaker cannot play a sound over its music' })
      Object.assign(next, { playerId: sp.id, playerName: sp.name })
    }
  }
  if (next.enabled && !next.playerId) throw createError({ statusCode: 400, statusMessage: 'Pick a speaker first' })
  await updateIntegration(db, sonos.row.id, { meta: { ...sonos.meta, doorbell: next } }, key)
  return next
}

export type RingOutcome = 'played' | 'off' | 'no-speaker' | 'failed'

/** The last ring on Sonos, shown in Settings so a silent kitchen can be explained */
export interface SonosLastRing {
  at: string
  outcome: RingOutcome
  test: boolean
  error?: string
}

/**
 * The doorbell rang (or the owner pressed Test): play the sound on the chosen speaker at the chosen volume. Sonos puts
 * the volume and music back itself. If the speaker's ID is unknown now, list the speakers once and find it by name.
 */
export async function ringDoorbell(db: Db, site: Site, key: string, baseUrl: string, opts: { test?: boolean; now?: number } = {}): Promise<SonosLastRing> {
  const test = !!opts.test
  const sonos = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
  if (!sonos || !sonos.creds.refreshToken) return { at: new Date(opts.now ?? Date.now()).toISOString(), outcome: 'off', test }
  const settings = doorbellSettings(sonos.meta)
  const record = async (r: Omit<SonosLastRing, 'at' | 'test'>) => {
    const ring: SonosLastRing = { at: new Date(opts.now ?? Date.now()).toISOString(), test, ...r }
    const fresh = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
    if (fresh) await updateIntegration(db, fresh.row.id, { meta: { ...fresh.meta, lastRing: ring } }, key)
    return ring
  }
  if (!settings.enabled && !test) return { at: new Date(opts.now ?? Date.now()).toISOString(), outcome: 'off', test }
  if (!settings.playerId) return record({ outcome: 'no-speaker' })
  const clip = {
    name: test ? 'WattsWise test' : 'Deurbel',
    volume: settings.volume,
    ...(settings.sound === 'dingdong' ? { streamUrl: `${baseUrl.replace(/\/$/, '')}${DOORBELL_SOUND_PATH}` } : {}),
  }
  try {
    await withSonos(db, site, key, async (auth) => {
      try {
        await sonosAudioClip(auth, settings.playerId!, clip)
      } catch (err) {
        if (!(err instanceof SonosError && err.kind === 'gone')) throw err
        const sp = findSpeaker(await listSpeakers(auth), { playerId: null, playerName: settings.playerName })
        if (!sp) throw new SonosError(`Sonos: ${settings.playerName ?? 'the speaker'} is not in the household any more`, 404, 'gone')
        await sonosAudioClip(auth, sp.id, clip)
        const now = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
        if (now) await updateIntegration(db, now.row.id, { meta: { ...now.meta, doorbell: { ...doorbellSettings(now.meta), playerId: sp.id, playerName: sp.name } } }, key)
      }
    })
    return record({ outcome: 'played' })
  } catch (err) {
    const message = (err as any)?.statusMessage ?? (err as Error).message
    return record({ outcome: 'failed', error: String(message).slice(0, 200) })
  }
}

/** Sonos errors as HTTP answers the app can show */
export function sonosHttpError(err: unknown): never {
  if (err instanceof SonosError) throw createError({ statusCode: err.kind === 'rate' ? 429 : 502, statusMessage: err.message })
  throw err
}
