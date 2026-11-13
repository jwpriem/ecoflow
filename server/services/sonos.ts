import { randomBytes } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import type { Db } from '../db/client'
import { doorbellSounds, type sites } from '../db/schema'
import {
  customSoundId,
  DOORBELL_SOUND_PATH,
  seasonOn,
  SOUND_FILES,
  type DoorbellSettings,
  doorbellSettings,
  findSpeaker,
  isDoorbellSound,
  isPlayerId,
  MAX_SOUND_BYTES,
  MAX_SOUNDS,
  sniffAudio,
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
  if (patch.seasonal !== undefined) next.seasonal = patch.seasonal === true
  if (patch.volume !== undefined) {
    const v = Number(patch.volume)
    if (!Number.isFinite(v)) throw createError({ statusCode: 400, statusMessage: 'Volume must be a number' })
    next.volume = Math.round(Math.min(100, Math.max(5, v)))
  }
  if (patch.sound !== undefined) {
    if (!isDoorbellSound(patch.sound)) throw createError({ statusCode: 400, statusMessage: 'Unknown sound' })
    const custom = customSoundId(patch.sound)
    if (custom && !(await soundRow(db, site.id, custom))) throw createError({ statusCode: 400, statusMessage: 'Unknown sound' })
    next.sound = patch.sound
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
  /** What was played, e.g. kerst in December */
  sound?: string
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
  const base = baseUrl.replace(/\/$/, '')
  // In Halloween week and in December the themed sound takes over, if the owner wants that
  const season = settings.seasonal ? seasonOn(new Date(opts.now ?? Date.now()), site.timezone) : null
  const sound = season ?? settings.sound
  const custom = customSoundId(sound)
  const own = custom ? await soundRow(db, site.id, custom) : null
  const file = SOUND_FILES[sound as keyof typeof SOUND_FILES]
  // An uploaded sound that was removed meanwhile falls back to the ding-dong rather than staying silent
  const streamUrl = own ? `${base}${soundPath(own)}` : sound === 'chime' ? undefined : `${base}${file ?? DOORBELL_SOUND_PATH}`
  const clip = { name: test ? 'WattsWise test' : 'Deurbel', volume: settings.volume, ...(streamUrl ? { streamUrl } : {}) }
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
    return record({ outcome: 'played', sound })
  } catch (err) {
    const message = (err as any)?.statusMessage ?? (err as Error).message
    return record({ outcome: 'failed', error: String(message).slice(0, 200) })
  }
}

type SoundRow = typeof doorbellSounds.$inferSelect

async function soundRow(db: Db, siteId: number, id: number): Promise<Pick<SoundRow, 'id' | 'token' | 'mime'> | null> {
  const [row] = await db
    .select({ id: doorbellSounds.id, token: doorbellSounds.token, mime: doorbellSounds.mime })
    .from(doorbellSounds)
    .where(and(eq(doorbellSounds.id, id), eq(doorbellSounds.siteId, siteId)))
  return row ?? null
}

/** Where the speaker fetches an uploaded sound; the extension tells Sonos what it gets */
export const soundPath = (s: Pick<SoundRow, 'token' | 'mime'>) => `/api/sonos/sounds/play/${s.token}.${s.mime === 'audio/wav' ? 'wav' : 'mp3'}`

/** The uploaded sounds, without the audio itself */
export function listSounds(db: Db, siteId: number) {
  return db
    .select({ id: doorbellSounds.id, name: doorbellSounds.name, mime: doorbellSounds.mime, bytes: sql<number>`(length(${doorbellSounds.audio}) * 3 / 4)::int`, createdAt: doorbellSounds.createdAt })
    .from(doorbellSounds)
    .where(eq(doorbellSounds.siteId, siteId))
    .orderBy(asc(doorbellSounds.id))
}

/** Store an uploaded MP3 or WAV (base64 from the app). The name is what Settings shows. */
export async function addSound(db: Db, siteId: number, body: { name?: unknown; data?: unknown }) {
  const name = String(body.name ?? '').replace(/\.(mp3|wav)$/i, '').trim().slice(0, 40)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Give the sound a name' })
  const data = typeof body.data === 'string' ? body.data.replace(/^data:[^,]*,/, '') : ''
  // base64 is 4/3 of the file: refuse a large one before decoding it
  if (!data || data.length > Math.ceil((MAX_SOUND_BYTES * 4) / 3) + 4) throw createError({ statusCode: 400, statusMessage: 'The sound file is larger than 1 MB' })
  const buf = Buffer.from(data, 'base64')
  if (buf.length > MAX_SOUND_BYTES) throw createError({ statusCode: 400, statusMessage: 'The sound file is larger than 1 MB' })
  const mime = sniffAudio(buf)
  if (!mime) throw createError({ statusCode: 400, statusMessage: 'Only MP3 and WAV files can be played on Sonos' })
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(doorbellSounds).where(eq(doorbellSounds.siteId, siteId))) as [{ n: number }]
  if (n >= MAX_SOUNDS) throw createError({ statusCode: 400, statusMessage: 'You can keep up to 10 sounds. Remove one first.' })
  const [row] = await db
    .insert(doorbellSounds)
    .values({ siteId, name, mime, audio: buf.toString('base64'), token: randomBytes(24).toString('base64url') })
    .returning({ id: doorbellSounds.id, name: doorbellSounds.name, mime: doorbellSounds.mime, createdAt: doorbellSounds.createdAt })
  return { ...row!, bytes: buf.length }
}

/** Remove an uploaded sound; if the doorbell used it, it goes back to the ding-dong */
export async function deleteSound(db: Db, site: Site, key: string, id: number) {
  await db.delete(doorbellSounds).where(and(eq(doorbellSounds.id, id), eq(doorbellSounds.siteId, site.id)))
  const sonos = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
  if (sonos && doorbellSettings(sonos.meta).sound === `custom:${id}`)
    await updateIntegration(db, sonos.row.id, { meta: { ...sonos.meta, doorbell: { ...doorbellSettings(sonos.meta), sound: 'dingdong' } } }, key)
}

/** The audio for the speaker, by its secret token */
export async function soundByToken(db: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null
  const [row] = await db.select({ mime: doorbellSounds.mime, audio: doorbellSounds.audio }).from(doorbellSounds).where(eq(doorbellSounds.token, token))
  return row ? { mime: row.mime, audio: Buffer.from(row.audio, 'base64') } : null
}

/** Sonos errors as HTTP answers the app can show */
export function sonosHttpError(err: unknown): never {
  if (err instanceof SonosError) throw createError({ statusCode: err.kind === 'rate' ? 429 : 502, statusMessage: err.message })
  throw err
}
