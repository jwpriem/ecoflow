import type { HueResource } from '../providers/hue'

/** One lamp as the Lights tab shows it */
export interface HueLight {
  id: string
  name: string
  archetype: string | null
  on: boolean
  /** 0-100 */
  brightness: number
  /** Colour temperature in mirek (153 = cool, 500 = warm); null when the lamp shows a colour */
  mirek: number | null
  xy: { x: number; y: number } | null
  supports: { dim: boolean; temperature: boolean; color: boolean }
  mirekMin: number
  mirekMax: number
  reachable: boolean
}

/** A room or zone: lamps that are switched together through their grouped_light */
export interface HueGroup {
  id: string
  kind: 'room' | 'zone'
  name: string
  archetype: string | null
  groupedLightId: string | null
  lightIds: string[]
  on: boolean
  brightness: number
}

export interface HueState {
  lights: HueLight[]
  groups: HueGroup[]
}

export interface HueRaw {
  lights: HueResource[]
  rooms: HueResource[]
  zones: HueResource[]
  groupedLights: HueResource[]
  devices: HueResource[]
  connectivity: HueResource[]
}

const DEFAULT_MIREK = { min: 153, max: 500 }

/**
 * Turn the bridge's resources into lamps and groups. A room lists devices (a lamp's light is one of its device's
 * services), a zone lists lights. A lamp counts as unreachable when its device's Zigbee connection says so.
 */
export function hueState(raw: HueRaw): HueState {
  const unreachable = new Set(raw.connectivity.filter((c) => c.status && c.status !== 'connected').map((c) => c.owner?.rid))
  const deviceOfLight = new Map<string, string>()
  for (const l of raw.lights) if (l.owner?.rtype === 'device') deviceOfLight.set(l.id, l.owner.rid)
  const lightsOfDevice = new Map<string, string[]>()
  for (const d of raw.devices) lightsOfDevice.set(d.id, (d.services ?? []).filter((s) => s.rtype === 'light').map((s) => s.rid))
  const deviceName = new Map(raw.devices.map((d) => [d.id, d.metadata?.name]))

  const lights: HueLight[] = raw.lights.map((l) => {
    const ct = l.color_temperature
    const device = deviceOfLight.get(l.id)
    return {
      id: l.id,
      name: l.metadata?.name ?? (device ? deviceName.get(device) : undefined) ?? 'Hue',
      archetype: l.metadata?.archetype ?? null,
      on: !!l.on?.on,
      brightness: Math.round(l.dimming?.brightness ?? (l.on?.on ? 100 : 0)),
      mirek: ct?.mirek_valid !== false ? (ct?.mirek ?? null) : null,
      xy: l.color?.xy ?? null,
      supports: { dim: !!l.dimming, temperature: !!ct, color: !!l.color },
      mirekMin: ct?.mirek_schema?.mirek_minimum ?? DEFAULT_MIREK.min,
      mirekMax: ct?.mirek_schema?.mirek_maximum ?? DEFAULT_MIREK.max,
      reachable: !(device && unreachable.has(device)),
    }
  })
  const known = new Set(lights.map((l) => l.id))
  const grouped = new Map(raw.groupedLights.map((g) => [g.id, g]))

  const group = (r: HueResource, kind: 'room' | 'zone'): HueGroup => {
    const ids = (r.children ?? []).flatMap((c) => (c.rtype === 'light' ? [c.rid] : c.rtype === 'device' ? (lightsOfDevice.get(c.rid) ?? []) : []))
    const lightIds = [...new Set(ids)].filter((id) => known.has(id))
    const gl = (r.services ?? []).find((s) => s.rtype === 'grouped_light')
    const g = gl ? grouped.get(gl.rid) : undefined
    const members = lights.filter((l) => lightIds.includes(l.id))
    const lit = members.filter((l) => l.on)
    return {
      id: r.id,
      kind,
      name: r.metadata?.name ?? '',
      archetype: r.metadata?.archetype ?? null,
      groupedLightId: gl?.rid ?? null,
      lightIds,
      on: g?.on ? g.on.on : lit.length > 0,
      // The grouped_light's brightness is the average of the lamps that are on
      brightness: Math.round(g?.dimming?.brightness ?? (lit.length ? lit.reduce((s, l) => s + l.brightness, 0) / lit.length : 0)),
    }
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  return {
    lights: lights.sort(byName),
    groups: [...raw.rooms.map((r) => group(r, 'room')).sort(byName), ...raw.zones.map((z) => group(z, 'zone')).sort(byName)],
  }
}

/** What the app asks for: any of on/off, brightness, a white tone or a colour */
export interface HueChange {
  on?: boolean
  brightness?: number
  mirek?: number
  xy?: { x: number; y: number }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Check a change from the app and turn it into a CLIP v2 body for a light or grouped_light */
export function hueCommand(change: HueChange): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (typeof change.on === 'boolean') body.on = { on: change.on }
  if (change.brightness !== undefined) {
    const b = Number(change.brightness)
    if (!Number.isFinite(b)) throw new Error('brightness must be a number')
    // Dimming to 0 is "off" in the app; Hue's lowest level is just above 0
    if (b <= 0) body.on = { on: false }
    else {
      body.dimming = { brightness: clamp(Math.round(b * 10) / 10, 1, 100) }
      // Sliding the brightness up switches a lamp on, as in the Hue app
      if (body.on === undefined) body.on = { on: true }
    }
  }
  if (change.mirek !== undefined) {
    const m = Number(change.mirek)
    if (!Number.isFinite(m)) throw new Error('mirek must be a number')
    body.color_temperature = { mirek: Math.round(clamp(m, 153, 500)) }
  } else if (change.xy) {
    const x = Number(change.xy.x)
    const y = Number(change.xy.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('xy must be numbers')
    body.color = { xy: { x: clamp(x, 0, 1), y: clamp(y, 0, 1) } }
  }
  if (!Object.keys(body).length) throw new Error('Nothing to change')
  return body
}
