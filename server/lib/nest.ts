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
