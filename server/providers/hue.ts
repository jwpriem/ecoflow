import { providerCall } from './http'

/**
 * Philips Hue Remote API: the household's Hue Bridge, reached through Philips' cloud (api.meethue.com), because
 * the bridge sits on the home network and this app runs in the cloud. OAuth 2.0 with the client ID and secret of a
 * "Remote Hue API" app from developers.meethue.com; the owner signs in with their Hue account once and we keep the
 * refresh token. On top of that the bridge wants an application key ("username"), which we create remotely by
 * pressing the virtual link button. All calls then go to the bridge's CLIP v2 API under /route/clip/v2.
 */
const API = 'https://api.meethue.com'
const AUTHORIZE_URL = `${API}/v2/oauth2/authorize`
const TOKEN_URL = `${API}/v2/oauth2/token`
const CLIP = `${API}/route/clip/v2`
/** Shown in the Hue app under the bridge's connected apps */
const DEVICE_TYPE = 'wattswise#cloud'

export interface HueCredentials {
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
  /** ms since epoch */
  expiresAt?: number
  /** The bridge's application key for this app, sent as hue-application-key */
  appKey?: string
}

export type HueTokens = Required<Pick<HueCredentials, 'accessToken' | 'refreshToken' | 'expiresAt'>>

export class HueError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: 'auth' | 'rate' | 'other',
  ) {
    super(message)
  }
}

export function hueAuthorizeUrl(clientId: string, state: string): string {
  const qs = new URLSearchParams({ client_id: clientId, response_type: 'code', state })
  return `${AUTHORIZE_URL}?${qs}`
}

/** Hue answers 429 when we go too fast; retrying straight away only makes that worse */
const HUE_RETRY = { retryable: (res: Response) => res.status >= 500 }

async function tokenRequest(creds: HueCredentials, body: Record<string, string>): Promise<HueTokens> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
  const res = await providerCall(
    'hue',
    (signal) =>
      fetch(TOKEN_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(body).toString(),
        signal,
      }),
    HUE_RETRY,
  )
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const reason = String(data.error_description ?? data.error ?? data.fault ?? `HTTP ${res.status}`)
    throw new HueError(`Hue sign-in failed: ${reason}`, res.status, res.status >= 500 ? 'other' : 'auth')
  }
  const accessToken = String(data.access_token ?? '')
  const refreshToken = String(data.refresh_token ?? creds.refreshToken ?? '')
  const expiresIn = Number(data.expires_in ?? 7 * 86_400)
  if (!accessToken || !refreshToken) throw new HueError('Hue sign-in returned no tokens', res.status, 'other')
  return { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000 }
}

export const hueExchangeCode = (creds: HueCredentials, code: string) => tokenRequest(creds, { grant_type: 'authorization_code', code })

export const hueRefresh = (creds: HueCredentials) => tokenRequest(creds, { grant_type: 'refresh_token', refresh_token: creds.refreshToken ?? '' })

/** Refresh a day before the access token runs out (they last about a week) */
export const hueTokenNeedsRefresh = (expiresAt: number | undefined, now = Date.now()) => !expiresAt || expiresAt - now < 86_400_000

async function call<T>(method: string, url: string, accessToken: string, appKey: string | undefined, body?: unknown): Promise<T> {
  const res = await providerCall(
    'hue',
    (signal) =>
      fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(appKey ? { 'hue-application-key': appKey } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      }),
    HUE_RETRY,
  )
  const data = (await res.json().catch(() => ({}))) as any
  if (res.ok) {
    // CLIP v2 can answer 200 with errors for part of a change
    const errs = Array.isArray(data?.errors) ? data.errors : []
    if (errs.length && !(Array.isArray(data?.data) && data.data.length)) throw new HueError(`Hue: ${errs[0].description}`, res.status, 'other')
    return data as T
  }
  const detail = data?.errors?.[0]?.description ?? data?.fault?.faultstring ?? data?.error ?? `HTTP ${res.status}`
  if (res.status === 401 || res.status === 403) throw new HueError(`Hue: ${detail}`, res.status, 'auth')
  if (res.status === 429) throw new HueError('Hue is busy, try again in a moment', 429, 'rate')
  throw new HueError(`Hue: ${detail}`, res.status, 'other')
}

/**
 * Create the bridge's application key for this app. Remotely the link button is "pressed" by the API itself, so
 * the owner doesn't have to walk to the bridge. The old (v1) answer is a list: [{ success: { username } }].
 */
export async function hueCreateAppKey(accessToken: string): Promise<string> {
  await call('PUT', `${API}/route/api/0/config`, accessToken, undefined, { linkbutton: true })
  const r = await call<Array<{ success?: { username?: string }; error?: { description?: string } }>>('POST', `${API}/route/api`, accessToken, undefined, {
    devicetype: DEVICE_TYPE,
  })
  const username = r.find((x) => x.success?.username)?.success?.username
  if (!username) throw new HueError(`Hue bridge did not hand out a key: ${r.find((x) => x.error)?.error?.description ?? 'no answer'}`, 200, 'other')
  return username
}

export interface HueAuth {
  accessToken: string
  appKey: string
}

type Data<T> = { data: T[] }

/** All resources of one type from the bridge, e.g. light, room, zone, grouped_light, device */
export async function hueResources<T = HueResource>(auth: HueAuth, type: string): Promise<T[]> {
  const r = await call<Data<T>>('GET', `${CLIP}/resource/${type}`, auth.accessToken, auth.appKey)
  return r.data ?? []
}

export const huePut = (auth: HueAuth, type: string, id: string, body: unknown) =>
  call<Data<{ rid: string; rtype: string }>>('PUT', `${CLIP}/resource/${type}/${encodeURIComponent(id)}`, auth.accessToken, auth.appKey, body)

export const huePost = (auth: HueAuth, type: string, body: unknown) =>
  call<Data<{ rid: string; rtype: string }>>('POST', `${CLIP}/resource/${type}`, auth.accessToken, auth.appKey, body)

export const hueDelete = (auth: HueAuth, type: string, id: string) =>
  call<Data<{ rid: string; rtype: string }>>('DELETE', `${CLIP}/resource/${type}/${encodeURIComponent(id)}`, auth.accessToken, auth.appKey)

/** The parts of CLIP v2 resources we read; the bridge sends much more */
export interface HueResource {
  id: string
  type: string
  metadata?: { name?: string; archetype?: string }
  owner?: { rid: string; rtype: string }
  on?: { on: boolean }
  dimming?: { brightness: number; min_dim_level?: number }
  color_temperature?: { mirek: number | null; mirek_valid?: boolean; mirek_schema?: { mirek_minimum: number; mirek_maximum: number } }
  color?: { xy: { x: number; y: number }; gamut_type?: string }
  children?: Array<{ rid: string; rtype: string }>
  services?: Array<{ rid: string; rtype: string }>
  status?: string
}
