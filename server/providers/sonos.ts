import { providerCall } from './http'

/**
 * Sonos Control API (cloud). The owner makes a control integration on developer.sonos.com, enters its key and secret
 * in Settings and signs in with their Sonos account once; we keep the refresh token. Commands go through Sonos' cloud
 * to the speakers at home, so this works from our server.
 *
 * For the doorbell we only need audioClip: the speaker ducks or pauses what it plays, plays the clip at the volume
 * we give and then goes back to its own volume and music by itself. Not every speaker can (the capability is
 * AUDIO_CLIP in the household's player list).
 */
const LOGIN = 'https://api.sonos.com/login/v3/oauth'
const TOKEN_URL = `${LOGIN}/access`
const CONTROL = 'https://api.ws.sonos.com/control/api/v1'
/** Shown nowhere, but Sonos wants one per clip: reversed domain name */
export const SONOS_APP_ID = 'eu.wattswise.app'

export interface SonosCredentials {
  /** The integration's key (client ID) */
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
  /** ms since epoch */
  expiresAt?: number
}

export type SonosTokens = Required<Pick<SonosCredentials, 'accessToken' | 'refreshToken' | 'expiresAt'>>

export class SonosError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** gone = the player or household is unknown now (speaker removed, or its ID changed) */
    readonly kind: 'auth' | 'rate' | 'gone' | 'other',
  ) {
    super(message)
  }
}

export function sonosAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const qs = new URLSearchParams({ client_id: clientId, response_type: 'code', state, scope: 'playback-control-all', redirect_uri: redirectUri })
  return `${LOGIN}?${qs}`
}

/** A doorbell clip that arrives half a minute late is worse than none: one quick retry, short timeouts */
const SONOS_OPTS = { retries: 1, timeoutMs: 8000, maxWaitMs: 2000, retryable: (res: Response) => res.status >= 500 }

async function tokenRequest(creds: SonosCredentials, body: Record<string, string>): Promise<SonosTokens> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
  const res = await providerCall(
    'sonos',
    (signal) =>
      fetch(TOKEN_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' },
        body: new URLSearchParams(body).toString(),
        signal,
      }),
    SONOS_OPTS,
  )
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const reason = String(data.error_description ?? data.error ?? `HTTP ${res.status}`)
    throw new SonosError(`Sonos sign-in failed: ${reason}`, res.status, res.status >= 500 ? 'other' : 'auth')
  }
  const accessToken = String(data.access_token ?? '')
  const refreshToken = String(data.refresh_token ?? creds.refreshToken ?? '')
  const expiresIn = Number(data.expires_in ?? 86_400)
  if (!accessToken || !refreshToken) throw new SonosError('Sonos sign-in returned no tokens', res.status, 'other')
  return { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000 }
}

export const sonosExchangeCode = (creds: SonosCredentials, code: string, redirectUri: string) =>
  tokenRequest(creds, { grant_type: 'authorization_code', code, redirect_uri: redirectUri })

export const sonosRefresh = (creds: SonosCredentials) => tokenRequest(creds, { grant_type: 'refresh_token', refresh_token: creds.refreshToken ?? '' })

/** Access tokens last 24 hours; refresh with an hour to spare, so a ring never waits on it */
export const sonosTokenNeedsRefresh = (expiresAt: number | undefined, now = Date.now()) => !expiresAt || expiresAt - now < 60 * 60_000

export interface SonosAuth {
  accessToken: string
  clientId: string
}

async function call<T>(method: string, path: string, auth: SonosAuth, body?: unknown): Promise<T> {
  const res = await providerCall(
    'sonos',
    (signal) =>
      fetch(`${CONTROL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          // Required by v1, deprecated later; harmless either way
          'X-Sonos-Api-Key': auth.clientId,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      }),
    SONOS_OPTS,
  )
  const data = (await res.json().catch(() => ({}))) as any
  if (res.ok) return data as T
  const detail = data?.reason ?? data?.errorCode ?? data?.fault?.faultstring ?? `HTTP ${res.status}`
  if (res.status === 401 || res.status === 403) throw new SonosError(`Sonos: ${detail}`, res.status, 'auth')
  if (res.status === 429) throw new SonosError('Sonos is busy, try again in a moment', 429, 'rate')
  if (res.status === 404 || res.status === 410) throw new SonosError(`Sonos: ${detail}`, res.status, 'gone')
  throw new SonosError(`Sonos: ${detail}`, res.status, 'other')
}

export interface SonosPlayerRaw {
  id: string
  name: string
  capabilities?: string[]
  deviceIds?: string[]
}

export async function sonosHouseholds(auth: SonosAuth): Promise<string[]> {
  const r = await call<{ households?: Array<{ id: string }> }>('GET', '/households', auth)
  return (r.households ?? []).map((h) => h.id)
}

export async function sonosPlayersOf(auth: SonosAuth, householdId: string): Promise<SonosPlayerRaw[]> {
  const r = await call<{ players?: SonosPlayerRaw[] }>('GET', `/households/${encodeURIComponent(householdId)}/groups`, auth)
  return r.players ?? []
}

export interface AudioClip {
  /** Shown in the Sonos app while it plays */
  name: string
  /** MP3 or WAV the speaker fetches itself; without it Sonos plays its built-in chime */
  streamUrl?: string
  /** 0–100; the speaker goes back to its own volume afterwards */
  volume: number
}

export function sonosAudioClip(auth: SonosAuth, playerId: string, clip: AudioClip) {
  return call<{ id?: string; status?: string }>('POST', `/players/${encodeURIComponent(playerId)}/audioClip`, auth, {
    name: clip.name.slice(0, 64),
    appId: SONOS_APP_ID,
    // HIGH: a clip from another app (another doorbell, an alarm) at LOW can't drown it out
    priority: 'HIGH',
    ...(clip.streamUrl ? { clipType: 'CUSTOM', streamUrl: clip.streamUrl } : { clipType: 'CHIME' }),
    volume: Math.round(Math.min(100, Math.max(0, clip.volume))),
  })
}
