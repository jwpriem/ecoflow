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
  isClockTime,
  isMusicId,
  localClock,
  type MorningRun,
  type MorningSettings,
  morningDue,
  morningSettings,
} from '../lib/sonos'
import {
  type SonosAuth,
  sonosAudioClip,
  sonosCreateGroup,
  type SonosCredentials,
  sonosFavorites,
  sonosLoadMusic,
  type SonosMusicItem,
  sonosPlayerVolume,
  sonosPlaylists,
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

/** What the morning music can play, per household: the Sonos favorites and Sonos playlists */
export function listMusic(db: Db, site: Site, key: string) {
  return withSonos(db, site, key, async (auth) => {
    const ids = await sonosHouseholds(auth)
    return Promise.all(
      ids.map(async (householdId) => {
        const [favorites, playlists] = await Promise.all([sonosFavorites(auth, householdId), sonosPlaylists(auth, householdId).catch((): SonosMusicItem[] => [])])
        return { householdId, favorites, playlists }
      }),
    )
  })
}

/** Change the morning music. Speakers must be ones we listed, all in one household; the music is checked against Sonos. */
export async function saveMorning(db: Db, site: Site, key: string, patch: Record<string, any>): Promise<MorningSettings> {
  const sonos = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
  if (!sonos) throw createError({ statusCode: 400, statusMessage: 'Connect Sonos in Settings first' })
  const next: MorningSettings = { ...morningSettings(sonos.meta) }
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true
  if (patch.shuffle !== undefined) next.shuffle = patch.shuffle === true
  if (patch.time !== undefined) {
    if (!isClockTime(patch.time)) throw createError({ statusCode: 400, statusMessage: 'Give a time like 07:00' })
    next.time = patch.time
  }
  if (patch.days !== undefined) {
    if (!Array.isArray(patch.days) || patch.days.some((d: unknown) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6))
      throw createError({ statusCode: 400, statusMessage: 'Unknown day' })
    next.days = [...new Set<number>(patch.days)].sort()
  }
  if (patch.volume !== undefined) {
    const v = Number(patch.volume)
    if (!Number.isFinite(v)) throw createError({ statusCode: 400, statusMessage: 'Volume must be a number' })
    next.volume = Math.round(Math.min(100, Math.max(5, v)))
  }
  if (patch.playerIds !== undefined) {
    if (!Array.isArray(patch.playerIds) || !patch.playerIds.every(isPlayerId)) throw createError({ statusCode: 400, statusMessage: 'Unknown speaker' })
    const speakers = (sonos.meta.speakers ?? []) as SonosSpeaker[]
    const picked = [...new Set<string>(patch.playerIds)].map((id) => speakers.find((s) => s.id === id))
    if (picked.some((s) => !s)) throw createError({ statusCode: 400, statusMessage: 'Unknown speaker' })
    const households = new Set(picked.map((s) => s!.householdId))
    if (households.size > 1) throw createError({ statusCode: 400, statusMessage: 'These speakers are in different Sonos households' })
    if (picked.length && next.source && next.householdId && picked[0]!.householdId !== next.householdId) next.source = null
    next.players = picked.map((s) => ({ id: s!.id, name: s!.name }))
    next.householdId = picked[0]?.householdId ?? next.householdId
  }
  if (patch.source !== undefined) {
    if (patch.source === null) next.source = null
    else {
      const { kind, id } = patch.source ?? {}
      if ((kind !== 'favorite' && kind !== 'playlist') || !isMusicId(id)) throw createError({ statusCode: 400, statusMessage: 'Unknown music' })
      const households = await listMusic(db, site, key)
      const h = households.find((x) => x.householdId === next.householdId) ?? (next.householdId ? undefined : households[0])
      const item = h?.[kind === 'favorite' ? 'favorites' : 'playlists'].find((i) => i.id === id)
      if (!h || !item) throw createError({ statusCode: 400, statusMessage: 'Unknown music' })
      next.source = { kind, id, name: item.name }
      next.householdId = h.householdId
    }
  }
  if (next.enabled && !next.players.length) throw createError({ statusCode: 400, statusMessage: 'Pick a speaker first' })
  if (next.enabled && !next.source) throw createError({ statusCode: 400, statusMessage: 'Pick the music first' })
  const fresh = (await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)) ?? sonos
  await updateIntegration(db, fresh.row.id, { meta: { ...fresh.meta, morning: next } }, key)
  return next
}

/**
 * Start the morning music: group the speakers, set each one's volume, then play the favorite or playlist. If a speaker's
 * ID is unknown now (re-added to the household), list the speakers once and find it by name.
 */
async function playMorning(auth: SonosAuth, s: MorningSettings): Promise<Array<{ id: string; name: string }> | null> {
  const run = async (players: Array<{ id: string; name: string }>) => {
    const ids = players.map((p) => p.id)
    const groupId = await sonosCreateGroup(auth, s.householdId!, ids)
    // Volume first, so the first second isn't at last night's TV volume
    await Promise.all(ids.map((id) => sonosPlayerVolume(auth, id, s.volume)))
    await sonosLoadMusic(auth, groupId, s.source!.kind, s.source!.id, { shuffle: s.shuffle })
  }
  try {
    await run(s.players)
    return null
  } catch (err) {
    if (!(err instanceof SonosError && err.kind === 'gone')) throw err
    const speakers = await listSpeakers(auth)
    const found = s.players.map((p) => findSpeaker(speakers, { playerId: p.id, playerName: p.name }))
    const missing = s.players.filter((_, i) => !found[i])
    if (missing.length) throw new SonosError(`Sonos: ${missing.map((p) => p.name).join(', ')} is not in the household any more`, 404, 'gone')
    const players = found.map((p) => ({ id: p!.id, name: p!.name }))
    await run(players)
    return players
  }
}

/**
 * The scheduled tick (or the owner pressing Test): start the music if it's time. Scheduled starts are kept in
 * lastMorning, so each morning plays once; a test goes to lastMorningTest and never counts as this morning's.
 */
export async function startMorning(db: Db, site: Site, key: string, opts: { test?: boolean; now?: Date } = {}) {
  const test = !!opts.test
  const now = opts.now ?? new Date()
  const sonos = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
  if (!sonos || !sonos.creds.refreshToken) return test ? { outcome: 'failed' as const, error: 'Sign in with Sonos in Settings first' } : { skipped: 'no sonos' }
  const s = morningSettings(sonos.meta)
  const last = (sonos.meta.lastMorning ?? null) as MorningRun | null
  if (!test && !morningDue(s, last, now, site.timezone)) return { skipped: 'not now' }
  if (test && !s.players.length) return { outcome: 'failed' as const, error: 'Pick a speaker first' }
  if (test && !s.source) return { outcome: 'failed' as const, error: 'Pick the music first' }
  const date = localClock(now, site.timezone).date
  const attempts = !test && last && last.date === date ? last.attempts + 1 : 1
  let run: MorningRun
  try {
    const moved = await withSonos(db, site, key, (auth) => playMorning(auth, s))
    run = { at: now.toISOString(), date, outcome: 'played', test, attempts }
    if (moved) {
      const cur = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
      if (cur) await updateIntegration(db, cur.row.id, { meta: { ...cur.meta, morning: { ...morningSettings(cur.meta), players: moved } } }, key)
    }
  } catch (err) {
    const message = (err as any)?.statusMessage ?? (err as Error).message
    run = { at: now.toISOString(), date, outcome: 'failed', test, attempts, error: String(message).slice(0, 200) }
  }
  const fresh = await getIntegration<SonosCredentials>(db, site.id, 'sonos', key)
  if (fresh) await updateIntegration(db, fresh.row.id, { meta: { ...fresh.meta, [test ? 'lastMorningTest' : 'lastMorning']: run } }, key)
  // A failed scheduled start shows up in the job's health (it has an error) and is retried for a few minutes
  return run
}

/** Sonos errors as HTTP answers the app can show */
export function sonosHttpError(err: unknown): never {
  if (err instanceof SonosError) throw createError({ statusCode: err.kind === 'rate' ? 429 : 502, statusMessage: err.message })
  throw err
}
