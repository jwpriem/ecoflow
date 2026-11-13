import type { SdmDevice } from '../providers/nest'

export type CameraKind = 'doorbell' | 'camera' | 'display'

/** One camera for the Security tab */
export interface NestCamera {
  /** The last part of the SDM device name, which is what the commands take */
  id: string
  name: string
  room: string | null
  kind: CameraKind
  /** Can we show it live? Only WebRTC: RTSP (older Nest Cams) would need a server converting the stream */
  live: boolean
  protocols: string[]
  /** Width × height of the stream SDM promises, e.g. 640 × 480 for the wired doorbell */
  resolution: { width: number; height: number } | null
  /** Battery cameras can't extend a stream: it stops after 5 minutes */
  extendable: boolean
}

const KINDS: Record<string, CameraKind> = {
  'sdm.devices.types.DOORBELL': 'doorbell',
  'sdm.devices.types.CAMERA': 'camera',
  'sdm.devices.types.DISPLAY': 'display',
}

/** The battery cameras have a Battery trait in newer SDM answers; wired ones don't */
const isBattery = (d: SdmDevice) => !!d.traits?.['sdm.devices.traits.Battery']

export const deviceId = (name: string) => name.split('/').pop() ?? name

/** Device IDs are long base64url-ish strings; anything else never reaches Google */
export const isDeviceId = (id: string) => /^[A-Za-z0-9_-]{8,200}$/.test(id)

/** The cameras, doorbells and Nest Hub Max among the devices, doorbells first, then by name */
export function nestCameras(devices: SdmDevice[]): NestCamera[] {
  const out: NestCamera[] = []
  for (const d of devices) {
    const kind = KINDS[d.type]
    const stream = d.traits?.['sdm.devices.traits.CameraLiveStream']
    if (!kind || !stream) continue
    const room = d.parentRelations?.find((p) => p.displayName)?.displayName ?? null
    const custom = String(d.traits?.['sdm.devices.traits.Info']?.customName ?? '').trim()
    const protocols: string[] = Array.isArray(stream.supportedProtocols) ? stream.supportedProtocols : []
    const res = stream.maxVideoResolution
    out.push({
      id: deviceId(d.name),
      name: custom || room || (kind === 'doorbell' ? 'Doorbell' : 'Camera'),
      room,
      kind,
      live: protocols.includes('WEB_RTC'),
      protocols,
      resolution: res?.width && res?.height ? { width: Number(res.width), height: Number(res.height) } : null,
      extendable: !isBattery(d),
    })
  }
  const order: Record<CameraKind, number> = { doorbell: 0, camera: 1, display: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
}

/**
 * Google's checks on the offer: audio, video and application lines in that order, Opus audio set to receive only,
 * ending on a newline. A browser offer with the transceivers made in that order passes; this catches the rest early
 * with a clear message instead of Google's PERMISSION_DENIED.
 */
export function checkOffer(sdp: string): string | null {
  if (typeof sdp !== 'string' || sdp.length < 50 || sdp.length > 20_000) return 'Invalid offer'
  if (!sdp.startsWith('v=0')) return 'Invalid offer'
  const kinds = [...sdp.matchAll(/^m=(\w+)/gm)].map((m) => m[1])
  if (kinds.join(',') !== 'audio,video,application') return 'The offer needs audio, video and data, in that order'
  return null
}

/** Google wants the offer to end on a newline */
export const withNewline = (sdp: string) => (sdp.endsWith('\n') ? sdp : `${sdp}\r\n`)

export type NestEventKind = 'chime' | 'person' | 'motion'

/** One camera event out of a Pub/Sub push, reduced to what a notification needs */
export interface NestEvent {
  deviceId: string
  kinds: NestEventKind[]
  /** Links the motion, person and clip events of one occurrence */
  sessionId: string | null
  /** When the camera saw it */
  at: Date
}

const EVENT_KINDS: Record<string, NestEventKind> = {
  'sdm.devices.events.DoorbellChime.Chime': 'chime',
  'sdm.devices.events.CameraPerson.Person': 'person',
  'sdm.devices.events.CameraMotion.Motion': 'motion',
}

/**
 * Pub/Sub pushes { message: { data: base64(json) } }. The JSON is an SDM event: resourceUpdate.name is the device,
 * resourceUpdate.events the events in it. Trait updates (no events) and clip previews give nothing to notify.
 */
export function parseNestEvent(body: unknown): NestEvent | null {
  const data = (body as { message?: { data?: unknown } })?.message?.data
  if (typeof data !== 'string') return null
  let ev: any
  try {
    ev = JSON.parse(Buffer.from(data, 'base64').toString('utf8'))
  } catch {
    return null
  }
  const name = ev?.resourceUpdate?.name
  const events = ev?.resourceUpdate?.events
  if (typeof name !== 'string' || !events || typeof events !== 'object') return null
  const kinds: NestEventKind[] = []
  let sessionId: string | null = null
  for (const [key, value] of Object.entries(events as Record<string, any>)) {
    const kind = EVENT_KINDS[key]
    sessionId ??= typeof value?.eventSessionId === 'string' ? value.eventSessionId : null
    if (kind && !kinds.includes(kind)) kinds.push(kind)
  }
  if (!kinds.length) return null
  const at = new Date(ev.timestamp ?? Date.now())
  return { deviceId: deviceId(name), kinds, sessionId, at: Number.isNaN(at.getTime()) ? new Date() : at }
}

/** Ringing beats a person beats motion */
const RANK: Record<NestEventKind, number> = { chime: 3, person: 2, motion: 1 }

/**
 * Decides which events become a notification. A ring always does (once per session). Motion and people at most
 * once per camera per few minutes, except that a person seen after the motion of the same session still comes
 * through, replacing the motion notification. Old events (Pub/Sub retrying after downtime) are dropped.
 */
export class NestEventGate {
  private sessions = new Map<string, { rank: number; at: number }>()
  private lastByCamera = new Map<string, number>()

  constructor(
    private readonly quietMs = 3 * 60_000,
    private readonly maxAgeMs = 2 * 60_000,
  ) {}

  decide(siteId: number, ev: NestEvent, now = Date.now()): NestEventKind | null {
    if (now - ev.at.getTime() > this.maxAgeMs) return null
    this.prune(now)
    const kind = [...ev.kinds].sort((a, b) => RANK[b] - RANK[a])[0]!
    const cam = `${siteId}:${ev.deviceId}`
    const key = `${cam}:${ev.sessionId ?? ev.at.getTime()}`
    const seen = this.sessions.get(key)
    // Already told about this occurrence at this level or higher
    if (seen && seen.rank >= RANK[kind]) return null
    const upgrade = !!seen
    if (kind !== 'chime' && !upgrade && now - (this.lastByCamera.get(cam) ?? -Infinity) < this.quietMs) return null
    this.sessions.set(key, { rank: RANK[kind], at: now })
    if (kind !== 'chime') this.lastByCamera.set(cam, now)
    return kind
  }

  private prune(now: number) {
    if (this.sessions.size < 500) return
    for (const [k, v] of this.sessions) if (now - v.at > 60 * 60_000) this.sessions.delete(k)
  }
}

/** The last time someone rang, kept with the connection so Home can say it without asking Google */
export interface NestLastRing {
  at: string
  cameraId: string
  name: string | null
}

/** The ring to remember after an event: a newer ring replaces it, anything else leaves it as it was */
export function nextLastRing<T extends NestLastRing | undefined>(prev: T, ev: NestEvent | null, names: Record<string, string>): T | NestLastRing {
  if (!ev || !ev.kinds.includes('chime')) return prev
  // Pub/Sub can deliver an old event late
  if (prev && Date.parse(prev.at) >= ev.at.getTime()) return prev
  return { at: ev.at.toISOString(), cameraId: ev.deviceId, name: names[ev.deviceId] ?? null }
}

/** The stored last ring of a signed-in Nest connection, or null */
export function lastRing(meta: Record<string, unknown>): NestLastRing | null {
  const r = meta.lastRing as Partial<NestLastRing> | undefined
  if (!meta.authorized || !r || typeof r.cameraId !== 'string' || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null
  return { at: r.at, cameraId: r.cameraId, name: typeof r.name === 'string' ? r.name : null }
}
