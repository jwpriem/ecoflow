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

/** chime = Sonos' own short chime; dingdong = our two-tone bell from /sounds/deurbel.mp3 */
export const DOORBELL_SOUNDS = ['dingdong', 'chime'] as const
export type DoorbellSound = (typeof DOORBELL_SOUNDS)[number]

export const DOORBELL_SOUND_PATH = '/sounds/deurbel.mp3'

/** What to do when the doorbell rings, kept in the Sonos integration's meta */
export interface DoorbellSettings {
  enabled: boolean
  /** Sonos player ID, e.g. RINCON_xxx */
  playerId: string | null
  /** Its name when picked: found again by name if the ID changes */
  playerName: string | null
  volume: number
  sound: DoorbellSound
}

export const DEFAULT_DOORBELL: DoorbellSettings = { enabled: false, playerId: null, playerName: null, volume: 45, sound: 'dingdong' }

/** The stored settings, with anything missing or odd replaced by the default */
export function doorbellSettings(meta: Record<string, unknown> | null | undefined): DoorbellSettings {
  const d = (meta?.doorbell ?? {}) as Partial<DoorbellSettings>
  const volume = Number(d.volume)
  return {
    enabled: d.enabled === true,
    playerId: typeof d.playerId === 'string' && d.playerId ? d.playerId : null,
    playerName: typeof d.playerName === 'string' && d.playerName ? d.playerName : null,
    volume: Number.isFinite(volume) ? Math.round(Math.min(100, Math.max(5, volume))) : DEFAULT_DOORBELL.volume,
    sound: DOORBELL_SOUNDS.includes(d.sound as DoorbellSound) ? (d.sound as DoorbellSound) : DEFAULT_DOORBELL.sound,
  }
}

/** Sonos player IDs look like RINCON_347E5C0E1A2B01400; anything else never reaches Sonos */
export const isPlayerId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_.:-]{4,100}$/.test(id)

/** The speaker for the doorbell: by ID, or by name when the ID changed (speaker re-added to the household) */
export function findSpeaker(speakers: SonosSpeaker[], s: Pick<DoorbellSettings, 'playerId' | 'playerName'>): SonosSpeaker | null {
  return speakers.find((p) => p.id === s.playerId) ?? (s.playerName ? speakers.find((p) => p.name === s.playerName) : undefined) ?? null
}
