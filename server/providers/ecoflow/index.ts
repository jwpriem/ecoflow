import { createHmac, randomInt } from 'node:crypto'
import type { BatteryMode } from '../../lib/types'
import type { devices } from '../../db/schema'

export type DeviceRow = typeof devices.$inferSelect

/**
 * EcoFlow IoT Open API (developer-eu.ecoflow.com): access key + secret key, every request signed with HMAC-SHA256.
 * Used for reading the STREAM Pro. Control still has to be proven (phase 0, see docs/plans).
 */
export const ECOFLOW_HOST = 'https://api-e.ecoflow.com'
const UA = 'ecoflow-energy/0.1'

export interface EcoFlowCredentials {
  accessKey: string
  secretKey: string
}

export interface EcoFlowDevice {
  sn: string
  deviceName?: string
  productName?: string
  online: number
}

export interface BatteryCommand {
  mode: BatteryMode
  powerW?: number
  validUntil: Date
}

/** What the collector keeps per battery in devices.state. Power in W, + = charging. */
export interface DeviceState {
  soc?: number // 0-1
  powerW?: number
  /** STREAM Pro direct PV input */
  pvW?: number
  online?: boolean
  ts?: string
  /** Last mode/power the strategy decided on, so the same command is not logged every run */
  mode?: BatteryMode
  commandW?: number
  /** Last raw reading from the API, kept for debugging the key mapping */
  quota?: Record<string, unknown>
  /** MQTT stream health for this unit */
  mqtt?: Record<string, unknown>
}

export interface StreamReading {
  soc: number | null
  powerW: number
  pvW: number
  /** The unit's own pack level (bmsBattSoc, from MQTT) */
  packSoc?: number | null
  /** The system level (cmsBattSoc); only the leader of a multi-unit system reports it */
  systemSoc?: number | null
  /** The unit's own battery power from vol x amp (MQTT), + = charging */
  packPowerW?: number | null
}

/**
 * Flatten the parameters the way EcoFlow signs them: nested objects as `a.b`, arrays as `a[0]`,
 * sorted by key (ASCII) and joined as `k=v&k=v`.
 */
export function flattenParams(value: unknown, prefix = '', out: [string, string][] = []): [string, string][] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenParams(v, `${prefix}[${i}]`, out))
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flattenParams(v, prefix ? `${prefix}.${k}` : k, out)
  } else if (value !== undefined && prefix) {
    out.push([prefix, String(value)])
  }
  return out
}

export function signString(params: unknown, accessKey: string, nonce: string, timestamp: string): string {
  const pairs = flattenParams(params ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const base = pairs.map(([k, v]) => `${k}=${v}`).join('&')
  const auth = `accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`
  return base ? `${base}&${auth}` : auth
}

export function sign(secretKey: string, str: string): string {
  return createHmac('sha256', secretKey).update(str).digest('hex')
}

export interface RequestOptions {
  host?: string
  fetch?: typeof fetch
  now?: () => number
  nonce?: () => string
}

/** One signed call. GET sends the params as query string, other methods as JSON body. Throws on a non-zero code. */
export async function ecoflowRequest<T>(
  creds: EcoFlowCredentials,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  params: Record<string, unknown> = {},
  opts: RequestOptions = {},
): Promise<T> {
  const nonce = opts.nonce?.() ?? String(randomInt(100000, 1000000))
  const timestamp = String(opts.now?.() ?? Date.now())
  const headers: Record<string, string> = {
    accessKey: creds.accessKey,
    nonce,
    timestamp,
    sign: sign(creds.secretKey, signString(params, creds.accessKey, nonce, timestamp)),
    'User-Agent': UA,
  }
  let url = `${opts.host ?? ECOFLOW_HOST}${path}`
  let body: string | undefined
  if (method === 'GET') {
    const qs = flattenParams(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    if (qs) url += `?${qs}`
  } else {
    headers['Content-Type'] = 'application/json;charset=UTF-8'
    body = JSON.stringify(params)
  }
  const res = await (opts.fetch ?? fetch)(url, { method, headers, body })
  if (!res.ok) throw new Error(`EcoFlow HTTP ${res.status}`)
  const json = (await res.json()) as { code?: string | number; message?: string; data?: T }
  if (String(json.code) !== '0') throw new Error(`EcoFlow: ${json.message || 'error'} (code ${json.code})`)
  return json.data as T
}

export function listDevices(creds: EcoFlowCredentials, opts?: RequestOptions) {
  return ecoflowRequest<EcoFlowDevice[]>(creds, 'GET', '/iot-open/sign/device/list', {}, opts).then((d) => d ?? [])
}

export function deviceQuota(creds: EcoFlowCredentials, sn: string, opts?: RequestOptions) {
  return ecoflowRequest<Record<string, unknown>>(creds, 'GET', '/iot-open/sign/device/quota/all', { sn }, opts).then((d) => d ?? {})
}

/**
 * Per-pack keys of the STREAM BMS, pushed over MQTT (the REST quota leaves them out).
 * The cms* keys are the system values, which only the leader of a multi-unit system reports.
 */
export const PACK_KEYS = ['bmsBattSoc', 'f32ShowSoc', 'bmsDesignCap', 'vol', 'amp', 'accuChgEnergy', 'accuDsgEnergy', 'distributedDeviceStatus', 'bmsChgDsgState']

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/**
 * Map a STREAM quota to what the app stores. Keys as reported for the STREAM series:
 * - bmsBattSoc: this unit's own pack level in %, when the API returns it
 * - cmsBattSoc: charge level in % (a follower unit in a multi-unit system reports 0)
 * - powGetBpCms: battery power in W, + = charging, - = discharging (confirmed live: -800 while the SoC fell and powGetSysLoad was 800)
 * - cmsChgDsgState / bmsChgDsgState: 0 idle, 1 discharging, 2 charging; wins over the sign when present
 * - vol (mV) x amp (mA), from MQTT: this unit's own battery power, - while discharging; wins over the above
 * - powGetPvSum (or powGetPv + powGetPv2...): direct PV input in W
 */
export function parseStreamQuota(q: Record<string, unknown>): StreamReading {
  const pack = num(q.f32ShowSoc) || num(q.bmsBattSoc)
  const system = num(q.cmsBattSoc)
  const socPct = pack ? pack : (system ?? pack ?? num(q.soc))
  const pct = (v: number | undefined) => (v === undefined ? null : Math.min(1, Math.max(0, v / 100)))
  const bp = num(q.powGetBpCms) ?? 0
  const state = num(q.cmsChgDsgState) ?? num(q.bmsChgDsgState)
  let powerW = bp // same convention as the app: + = charging
  if (state === 2) powerW = Math.abs(bp)
  else if (state === 1) powerW = -Math.abs(bp)
  const vol = num(q.vol)
  const amp = num(q.amp)
  const packPowerW = vol !== undefined && amp !== undefined ? Math.round((vol * amp) / 1e6) || 0 : null
  if (packPowerW !== null) powerW = packPowerW
  const pvW =
    num(q.powGetPvSum) ??
    ['powGetPv', 'powGetPv2', 'powGetPv3', 'powGetPv4'].reduce((s, k) => s + (num(q[k]) ?? 0), 0)
  return {
    soc: pct(socPct),
    powerW: Math.round(powerW) || 0,
    pvW: Math.max(0, Math.round(pvW)),
    packSoc: pack ? pct(pack) : null,
    systemSoc: pct(system),
    packPowerW,
  }
}

/** STREAM units first, so a mixed account (e.g. also a power station) does not end up as batteries */
export function streamDevices(list: EcoFlowDevice[]): EcoFlowDevice[] {
  const streams = list.filter((d) => /stream/i.test(d.productName ?? '') || /stream/i.test(d.deviceName ?? ''))
  return streams.length ? streams : list
}

/**
 * Several STREAM units on one account work as one system: the leader reports the system values
 * (charge level, battery power, PV) and the followers report 0 for all of them. Share the leader's
 * power and PV over all units by capacity, so the totals come out right. Each unit keeps its own
 * pack level and power when MQTT delivered them, otherwise it gets the system level and a share of the power.
 * Units that all report something are left as they are.
 */
export function shareSystemReading<T extends { capacityWh: number; reading: StreamReading }>(units: T[]): T[] {
  const isLeader = (r: StreamReading) => !!(r.systemSoc || r.pvW || (r.packPowerW == null && r.powerW))
  const leaders = units.filter((u) => isLeader(u.reading))
  if (units.length < 2 || leaders.length !== 1) return units
  const lead = leaders[0]!.reading
  const totalCap = units.reduce((s, u) => s + u.capacityWh, 0) || 1
  return units.map((u) => {
    const share = u.capacityWh / totalCap
    const soc = u.reading.packSoc || (lead.systemSoc ?? lead.soc)
    const powerW = u.reading.packPowerW ?? Math.round(lead.powerW * share)
    return { ...u, reading: { ...u.reading, soc, powerW, pvW: Math.round(lead.pvW * share) } }
  })
}
