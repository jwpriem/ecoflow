import { createHash, createHmac, randomUUID } from 'node:crypto'
import { providerCall } from './http'

/**
 * Tuya Open API (developer.tuya.com/en/docs/iot/new-singnature): reads a Tuya or Smart Life device straight from
 * Tuya's cloud, without a hub in between. The owner makes a free cloud project on platform.tuya.com (data center
 * Central Europe), links their Smart Life/Tuya app to it, and gives WattsWise the project's Access ID and Secret
 * and the device's ID. Every request is signed with HMAC-SHA256; a token lasts about two hours.
 */
export const TUYA_BASE = 'https://openapi.tuyaeu.com'

export interface TuyaCredentials {
  accessId: string
  accessSecret: string
  deviceId: string
}

export interface TuyaToken {
  accessToken: string
  /** ms since epoch */
  expiresAt: number
}

/** A temperature/humidity sensor's reading */
export interface IndoorReading {
  name: string
  online: boolean
  tempC: number | null
  humidity: number | null
  /** Percent, or null when the sensor only reports low/middle/high */
  battery: number | null
}

/** `auth`: the Access ID/Secret or the token is refused; `access`: the project may not read this device or its trial ran out */
export class TuyaError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'access' | 'other',
    readonly code?: number,
  ) {
    super(message)
  }
}

const AUTH_CODES = new Set([1004, 1010, 1011, 1012, 1013])
const ACCESS_CODES = new Set([1106, 2009, 2017, 28841002, 28841101])

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** The string Tuya signs: method, body hash, (no signed headers), path with its query sorted by key */
export function stringToSign(method: string, path: string, body = ''): string {
  const [base, query] = path.split('?')
  const sorted = query
    ? '?' +
      query
        .split('&')
        .filter(Boolean)
        .sort((a, b) => a.split('=')[0]!.localeCompare(b.split('=')[0]!))
        .join('&')
    : ''
  return [method.toUpperCase(), sha256(body), '', `${base}${sorted}`].join('\n')
}

/** Uppercase hex HMAC-SHA256 of client_id + access_token (empty for the token call) + t + nonce + stringToSign */
export function tuyaSign(opts: { accessId: string; secret: string; t: string; nonce: string; accessToken?: string; method: string; path: string; body?: string }): string {
  const str = opts.accessId + (opts.accessToken ?? '') + opts.t + opts.nonce + stringToSign(opts.method, opts.path, opts.body)
  return createHmac('sha256', opts.secret).update(str).digest('hex').toUpperCase()
}

async function call<T>(creds: TuyaCredentials, path: string, token?: TuyaToken, now = Date.now): Promise<T> {
  const res = await providerCall(
    'tuya',
    (signal) => {
      const t = String(now())
      const nonce = randomUUID()
      const sign = tuyaSign({ accessId: creds.accessId, secret: creds.accessSecret, t, nonce, accessToken: token?.accessToken, method: 'GET', path })
      return fetch(`${TUYA_BASE}${path}`, {
        headers: {
          client_id: creds.accessId,
          sign,
          t,
          nonce,
          sign_method: 'HMAC-SHA256',
          ...(token ? { access_token: token.accessToken } : {}),
        },
        signal,
      })
    },
    { retries: 1, timeoutMs: 10_000 },
  )
  const text = await res.text()
  let data: { success?: boolean; result?: T; code?: number; msg?: string } = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // Not JSON: the status below says enough
  }
  if (!res.ok || !data.success) {
    const code = typeof data.code === 'number' ? data.code : undefined
    const kind = code && AUTH_CODES.has(code) ? 'auth' : code && ACCESS_CODES.has(code) ? 'access' : 'other'
    const why = data.msg ?? (text.slice(0, 120) || `HTTP ${res.status}`)
    throw new TuyaError(`Tuya: ${why}${code ? ` (${code})` : ''}`, kind, code)
  }
  return data.result as T
}

export async function tuyaToken(creds: TuyaCredentials, now = Date.now): Promise<TuyaToken> {
  const r = await call<{ access_token: string; expire_time: number }>(creds, '/v1.0/token?grant_type=1', undefined, now)
  return { accessToken: r.access_token, expiresAt: now() + r.expire_time * 1000 }
}

interface TuyaDevice {
  name?: string
  online?: boolean
  status?: { code: string; value: unknown }[]
}

interface TuyaSpec {
  status?: { code: string; type?: string; values?: string }[]
}

const TEMP_CODES = ['va_temperature', 'temp_current', 'temp_indoor', 'temp_value']
const HUMIDITY_CODES = ['va_humidity', 'humidity_value', 'humidity_indoor', 'humidity_current']
const BATTERY_CODES = ['battery_percentage', 'va_battery', 'battery_value']

/** How many decimals a code's integer carries, from the device's specification (`scale`) */
export function scales(spec: TuyaSpec | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of spec?.status ?? []) {
    try {
      const v = s.values ? JSON.parse(s.values) : {}
      if (typeof v.scale === 'number') out[s.code] = v.scale
    } catch {
      // A spec value that isn't JSON: no scale for that code
    }
  }
  return out
}

function scaled(code: string, raw: number, sc: Record<string, number>, fallback: (v: number) => number): number {
  const s = sc[code]
  const v = s === undefined ? fallback(raw) : raw / 10 ** s
  return Math.round(v * 10) / 10
}

/** The temperature, humidity and battery out of a device's status. Without a specification, tenths are guessed from the size of the number. */
export function parseReading(device: TuyaDevice, spec: TuyaSpec | null): IndoorReading {
  const status = new Map((device.status ?? []).map((s) => [s.code, s.value]))
  const sc = scales(spec)
  const first = (codes: string[]) => {
    for (const c of codes) {
      const v = status.get(c)
      if (typeof v === 'number') return { code: c, value: v }
    }
    return null
  }
  const t = first(TEMP_CODES)
  const h = first(HUMIDITY_CODES)
  const b = first(BATTERY_CODES)
  return {
    name: device.name ?? 'Tuya',
    online: device.online ?? true,
    // Room temperatures above 60 °C don't happen: a bigger number is in tenths
    tempC: t ? scaled(t.code, t.value, sc, (v) => (Math.abs(v) > 60 ? v / 10 : v)) : null,
    humidity: h ? scaled(h.code, h.value, sc, (v) => (v > 100 ? v / 10 : v)) : null,
    battery: b ? scaled(b.code, b.value, sc, (v) => v) : null,
  }
}

/** Read one device: its status, scaled with its specification (which is optional, a project without it still reads) */
export async function tuyaReadSensor(creds: TuyaCredentials, token: TuyaToken): Promise<IndoorReading> {
  const id = encodeURIComponent(creds.deviceId)
  const device = await call<TuyaDevice>(creds, `/v1.0/devices/${id}`, token)
  const spec = await call<TuyaSpec>(creds, `/v1.0/devices/${id}/specifications`, token).catch((err) => {
    if (err instanceof TuyaError && err.kind === 'auth') throw err
    return null
  })
  return parseReading(device, spec)
}
