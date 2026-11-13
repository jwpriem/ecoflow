import { providerCall } from './http'

/**
 * Google Nest through Google's Smart Device Management (SDM) API, the "Device Access" programme. The owner registers
 * a Device Access project (one-off $5) and a Google Cloud OAuth client, enters the project ID, client ID and secret in
 * Settings and signs in with their Google account once in Google's Partner Connections Manager, where they pick the
 * cameras WattsWise may see. We keep the refresh token.
 *
 * The cameras we care about (Nest Doorbell wired, Nest Cam wired/battery) only stream over WebRTC: the browser makes
 * an SDP offer, we pass it to the camera with GenerateWebRtcStream and hand the answer back. The video then runs
 * from Google straight to the browser; our server never carries it.
 */
const PCM = 'https://nestservices.google.com/partnerconnections'
const TOKEN_URL = 'https://www.googleapis.com/oauth2/v4/token'
const SDM = 'https://smartdevicemanagement.googleapis.com/v1'
const SCOPE = 'https://www.googleapis.com/auth/sdm.service'

export interface NestCredentials {
  /** Device Access project ID (a UUID from console.nest.google.com/device-access) */
  projectId: string
  clientId: string
  clientSecret: string
  accessToken?: string
  refreshToken?: string
  /** ms since epoch */
  expiresAt?: number
}

export type NestTokens = Required<Pick<NestCredentials, 'accessToken' | 'refreshToken' | 'expiresAt'>>

export class NestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: 'auth' | 'rate' | 'offline' | 'other',
  ) {
    super(message)
  }
}

export function nestAuthorizeUrl(creds: Pick<NestCredentials, 'projectId' | 'clientId'>, redirectUri: string, state: string): string {
  const qs = new URLSearchParams({
    redirect_uri: redirectUri,
    access_type: 'offline',
    // Without consent Google hands out no new refresh token on a second sign-in
    prompt: 'consent',
    client_id: creds.clientId,
    response_type: 'code',
    scope: SCOPE,
    state,
  })
  return `${PCM}/${encodeURIComponent(creds.projectId)}/auth?${qs}`
}

/** A 429 means the camera's command quota is used up; retrying straight away only makes that worse */
const NEST_RETRY = { retryable: (res: Response) => res.status >= 500 }

async function tokenRequest(creds: NestCredentials, body: Record<string, string>): Promise<NestTokens> {
  const res = await providerCall(
    'nest',
    (signal) =>
      fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...body }).toString(),
        signal,
      }),
    NEST_RETRY,
  )
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const reason = String(data.error_description ?? data.error ?? `HTTP ${res.status}`)
    throw new NestError(`Google sign-in failed: ${reason}`, res.status, res.status >= 500 ? 'other' : 'auth')
  }
  const accessToken = String(data.access_token ?? '')
  // A refresh answers without a new refresh token: the old one stays valid
  const refreshToken = String(data.refresh_token ?? creds.refreshToken ?? '')
  const expiresIn = Number(data.expires_in ?? 3600)
  if (!accessToken || !refreshToken) throw new NestError('Google sign-in returned no tokens', res.status, 'other')
  return { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000 }
}

export const nestExchangeCode = (creds: NestCredentials, code: string, redirectUri: string) =>
  tokenRequest(creds, { grant_type: 'authorization_code', code, redirect_uri: redirectUri })

export const nestRefresh = (creds: NestCredentials) => tokenRequest(creds, { grant_type: 'refresh_token', refresh_token: creds.refreshToken ?? '' })

/** Access tokens last an hour; refresh five minutes before that */
export const nestTokenNeedsRefresh = (expiresAt: number | undefined, now = Date.now()) => !expiresAt || expiresAt - now < 5 * 60_000

async function call<T>(method: string, url: string, accessToken: string, body?: unknown): Promise<T> {
  const res = await providerCall(
    'nest',
    (signal) =>
      fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      }),
    NEST_RETRY,
  )
  const data = (await res.json().catch(() => ({}))) as any
  if (res.ok) return data as T
  const status = String(data?.error?.status ?? '')
  const detail = data?.error?.message ?? `HTTP ${res.status}`
  if (res.status === 401) throw new NestError(`Google Nest: ${detail}`, res.status, 'auth')
  if (res.status === 429) throw new NestError('Google Nest is busy, try again in a moment', 429, 'rate')
  // FAILED_PRECONDITION: the camera is offline, asleep or switched off in the Home app
  if (status === 'FAILED_PRECONDITION') throw new NestError('The camera is not available right now', res.status, 'offline')
  throw new NestError(`Google Nest: ${detail}`, res.status, 'other')
}

/** The raw device as SDM returns it; only the parts we read */
export interface SdmDevice {
  /** enterprises/{project}/devices/{id} */
  name: string
  type: string
  traits?: Record<string, any>
  parentRelations?: Array<{ parent: string; displayName?: string }>
}

/** Every device the owner shared in the Partner Connections Manager. The first call after sign-in also completes it. */
export async function nestDevices(accessToken: string, projectId: string): Promise<SdmDevice[]> {
  const r = await call<{ devices?: SdmDevice[] }>('GET', `${SDM}/enterprises/${encodeURIComponent(projectId)}/devices`, accessToken)
  return r.devices ?? []
}

export function nestCommand<T = Record<string, unknown>>(accessToken: string, projectId: string, deviceId: string, command: string, params: Record<string, unknown>) {
  const url = `${SDM}/enterprises/${encodeURIComponent(projectId)}/devices/${encodeURIComponent(deviceId)}:executeCommand`
  return call<{ results?: T }>('POST', url, accessToken, { command: `sdm.devices.commands.${command}`, params }).then((r) => r.results ?? ({} as T))
}
