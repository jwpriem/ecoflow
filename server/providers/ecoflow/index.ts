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
}

export interface StreamReading {
  soc: number | null
  powerW: number
  pvW: number
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

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/**
 * Map a STREAM quota to what the app stores. Keys as reported for the STREAM series:
 * - cmsBattSoc: charge level in % (a follower unit in a multi-unit system may report 0)
 * - powGetBpCms: battery pack power in W, positive when the battery delivers power
 * - cmsChgDsgState / bmsChgDsgState: 0 idle, 1 discharging, 2 charging; wins over the sign when present
 * - powGetPvSum (or powGetPv + powGetPv2...): direct PV input in W
 */
export function parseStreamQuota(q: Record<string, unknown>): StreamReading {
  const socPct = num(q.cmsBattSoc) ?? num(q.bmsBattSoc) ?? num(q.soc)
  const bp = num(q.powGetBpCms) ?? 0
  const state = num(q.cmsChgDsgState) ?? num(q.bmsChgDsgState)
  let powerW = -bp // app convention: + = charging
  if (state === 2) powerW = Math.abs(bp)
  else if (state === 1) powerW = -Math.abs(bp)
  const pvW =
    num(q.powGetPvSum) ??
    ['powGetPv', 'powGetPv2', 'powGetPv3', 'powGetPv4'].reduce((s, k) => s + (num(q[k]) ?? 0), 0)
  return {
    soc: socPct === undefined ? null : Math.min(1, Math.max(0, socPct / 100)),
    powerW: Math.round(powerW) || 0,
    pvW: Math.max(0, Math.round(pvW)),
  }
}

/** STREAM units first, so a mixed account (e.g. also a power station) does not end up as batteries */
export function streamDevices(list: EcoFlowDevice[]): EcoFlowDevice[] {
  const streams = list.filter((d) => /stream/i.test(d.productName ?? '') || /stream/i.test(d.deviceName ?? ''))
  return streams.length ? streams : list
}
