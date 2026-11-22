import type { SonosPlayerRaw } from '../providers/sonos'

/** One speaker to pick in Settings */
export interface SonosSpeaker {
  id: string
  name: string
  householdId: string
  /** Can it play a clip over what it plays? Older speakers (Play:1, Play:5 gen 1, Connect) can't */
  audioClip: boolean
}

/** The speakers of all households, the ones that can play a clip first, then by name */
export function sonosSpeakers(households: Array<{ id: string; players: SonosPlayerRaw[] }>): SonosSpeaker[] {
  const out: SonosSpeaker[] = []
  for (const h of households)
    for (const p of h.players) {
      if (!p?.id || out.some((s) => s.id === p.id)) continue
      out.push({ id: p.id, name: String(p.name ?? '').trim() || 'Sonos', householdId: h.id, audioClip: !!p.capabilities?.includes('AUDIO_CLIP') })
    }
  return out.sort((a, b) => Number(b.audioClip) - Number(a.audioClip) || a.name.localeCompare(b.name))
}

/**
 * chime = Sonos' own short chime; the others are our MP3s in public/sounds (synthesized, see scripts/doorbell-sounds.py).
 * halloween and kerst are also played by themselves in their season when that's switched on.
 */
export const SOUND_FILES = {
  dingdong: '/sounds/deurbel.mp3',
  westminster: '/sounds/westminster.mp3',
  'drie-tonen': '/sounds/drie-tonen.mp3',
  ouderwets: '/sounds/ouderwets.mp3',
  vrolijk: '/sounds/vrolijk.mp3',
  halloween: '/sounds/halloween.mp3',
  kerst: '/sounds/kerst.mp3',
} as const
export const DOORBELL_SOUNDS = ['dingdong', 'westminster', 'drie-tonen', 'ouderwets', 'vrolijk', 'halloween', 'kerst', 'chime'] as const
/** A built-in sound, or custom:<id> for one the owner uploaded (table doorbell_sounds) */
export type DoorbellSound = (typeof DOORBELL_SOUNDS)[number] | `custom:${number}`

export const isDoorbellSound = (s: unknown): s is DoorbellSound =>
  DOORBELL_SOUNDS.includes(s as (typeof DOORBELL_SOUNDS)[number]) || (typeof s === 'string' && /^custom:[1-9]\d{0,9}$/.test(s))

/** The uploaded sound's ID in custom:<id>, else null */
export const customSoundId = (s: string): number | null => (/^custom:[1-9]\d{0,9}$/.test(s) ? Number(s.slice(7)) : null)

/** Sonos plays only MP3 and WAV, so that's what an upload may be; the file itself decides, not its name */
export function sniffAudio(buf: Buffer): 'audio/mpeg' | 'audio/wav' | null {
  if (buf.length < 12) return null
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') return 'audio/wav'
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') return 'audio/mpeg'
  // An MP3 frame without ID3 tag: 11 sync bits, MPEG audio layer III
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0 && (buf[1]! & 0x06) === 0x02) return 'audio/mpeg'
  return null
}

/** Uploads stay small: a doorbell sound is a few seconds, and the speaker fetches it on every ring */
export const MAX_SOUND_BYTES = 1_000_000
export const MAX_SOUNDS = 10

export const DOORBELL_SOUND_PATH = SOUND_FILES.dingdong

export type Season = 'halloween' | 'kerst'

/** The themed sound's period, in the household's own date: Halloween week, and December up to Boxing Day */
export function seasonOn(at: Date, timeZone: string): Season | null {
  const [m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, month: '2-digit', day: '2-digit' })
    .format(at)
    .split('-')
    .map(Number) as [number, number]
  if (m === 10 && d >= 24) return 'halloween'
  if (m === 12 && d <= 26) return 'kerst'
  return null
}

/** What to do when the doorbell rings, kept in the Sonos integration's meta */
export interface DoorbellSettings {
  enabled: boolean
  /** Sonos player ID, e.g. RINCON_xxx */
  playerId: string | null
  /** Its name when picked: found again by name if the ID changes */
  playerName: string | null
  volume: number
  sound: DoorbellSound
  /** Play the Halloween or Christmas sound in its season instead of the chosen one */
  seasonal: boolean
}

export const DEFAULT_DOORBELL: DoorbellSettings = { enabled: false, playerId: null, playerName: null, volume: 45, sound: 'dingdong', seasonal: true }

/** The stored settings, with anything missing or odd replaced by the default */
export function doorbellSettings(meta: Record<string, unknown> | null | undefined): DoorbellSettings {
  const d = (meta?.doorbell ?? {}) as Partial<DoorbellSettings>
  const volume = Number(d.volume)
  return {
    enabled: d.enabled === true,
    playerId: typeof d.playerId === 'string' && d.playerId ? d.playerId : null,
    playerName: typeof d.playerName === 'string' && d.playerName ? d.playerName : null,
    volume: Number.isFinite(volume) ? Math.round(Math.min(100, Math.max(5, volume))) : DEFAULT_DOORBELL.volume,
    sound: isDoorbellSound(d.sound) ? d.sound : DEFAULT_DOORBELL.sound,
    seasonal: d.seasonal !== false,
  }
}

/** Sonos player IDs look like RINCON_347E5C0E1A2B01400; anything else never reaches Sonos */
export const isPlayerId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_.:-]{4,100}$/.test(id)

/** The speaker for the doorbell: by ID, or by name when the ID changed (speaker re-added to the household) */
export function findSpeaker(speakers: SonosSpeaker[], s: Pick<DoorbellSettings, 'playerId' | 'playerName'>): SonosSpeaker | null {
  return speakers.find((p) => p.id === s.playerId) ?? (s.playerName ? speakers.find((p) => p.name === s.playerName) : undefined) ?? null
}

/** What the morning music plays: a Sonos favorite or a Sonos playlist, by its ID in the household */
export interface MorningSource {
  kind: 'favorite' | 'playlist'
  id: string
  name: string
}

/** Music at a set time on one or more speakers together, kept in the Sonos integration's meta */
export interface MorningSettings {
  enabled: boolean
  /** Local time, HH:MM */
  time: string
  /** Days it plays: 0 = Sunday … 6 = Saturday */
  days: number[]
  /** Played together as one group */
  players: Array<{ id: string; name: string }>
  householdId: string | null
  source: MorningSource | null
  volume: number
  shuffle: boolean
}

export const DEFAULT_MORNING: MorningSettings = {
  enabled: false,
  time: '07:00',
  days: [1, 2, 3, 4, 5],
  players: [],
  householdId: null,
  source: null,
  volume: 20,
  shuffle: false,
}

export const isClockTime = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
/** Favorite and playlist IDs are short tokens; anything else never reaches Sonos */
export const isMusicId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_.:#/-]{1,100}$/.test(id)

/** The stored settings, with anything missing or odd replaced by the default */
export function morningSettings(meta: Record<string, unknown> | null | undefined): MorningSettings {
  const d = (meta?.morning ?? {}) as Partial<MorningSettings>
  const volume = Number(d.volume)
  const days = Array.isArray(d.days) ? [...new Set(d.days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : DEFAULT_MORNING.days
  const players = Array.isArray(d.players) ? d.players.filter((p) => p && isPlayerId(p.id)).map((p) => ({ id: p.id, name: String(p.name ?? '') })) : []
  const s = d.source
  const source = s && (s.kind === 'favorite' || s.kind === 'playlist') && isMusicId(s.id) ? { kind: s.kind, id: s.id, name: String(s.name ?? '') } : null
  return {
    enabled: d.enabled === true,
    time: isClockTime(d.time) ? d.time : DEFAULT_MORNING.time,
    days,
    players,
    householdId: typeof d.householdId === 'string' && d.householdId ? d.householdId : null,
    source,
    volume: Number.isFinite(volume) ? Math.round(Math.min(100, Math.max(5, volume))) : DEFAULT_MORNING.volume,
    shuffle: d.shuffle === true,
  }
}

/** The household's own date, weekday and minute of the day */
export function localClock(at: Date, timeZone: string): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

/** The last morning start, shown in Settings and used so a morning plays once */
export interface MorningRun {
  at: string
  /** The household's date it was for */
  date: string
  outcome: 'played' | 'failed'
  test: boolean
  /** Tries that day; a speaker that was asleep gets a few more minutes */
  attempts: number
  error?: string
}

/** After the set time it may still start this long, for a missed tick or a retry */
export const MORNING_WINDOW_MIN = 10
export const MORNING_MAX_ATTEMPTS = 3

/** Should the music start now? Once a day, on the chosen days, from the set time for a few minutes. */
export function morningDue(s: MorningSettings, last: MorningRun | null | undefined, at: Date, timeZone: string): boolean {
  if (!s.enabled || !s.players.length || !s.source || !s.householdId) return false
  const now = localClock(at, timeZone)
  if (!s.days.includes(now.weekday)) return false
  const [h, m] = s.time.split(':').map(Number) as [number, number]
  const since = now.minutes - (h * 60 + m)
  if (since < 0 || since >= MORNING_WINDOW_MIN) return false
  const today = last && !last.test && last.date === now.date ? last : null
  if (!today) return true
  return today.outcome === 'failed' && today.attempts < MORNING_MAX_ATTEMPTS
}
