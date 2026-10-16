/**
 * SolarEdge Monitoring API v2 (SolarEdge ONE) with Site Access: OAuth 2.0 with a client ID and secret
 * from developer.solaredge.com. The site owner grants access once on SolarEdge Connect; we keep the
 * refresh token. Every call costs one credit (Free tier: 2,000 a month, 10 a minute), so callers budget
 * through services/solaredge.ts.
 */
const API = 'https://monitoringapi.solaredge.com/v2'
const AUTHORIZE_URL = 'https://connect.solaredge.com/authorize'
const SCOPES = 'SITE_DATA DEVICE_DATA'
/** Longest grant SolarEdge Connect allows, in months; the owner has to approve again after that */
const ACCESS_DURATION_MONTHS = '24'

export interface SolarEdgeCredentials {
  clientId: string
  clientSecret: string
  accessToken?: string
  /** Rotates on every refresh; the old one stops working */
  refreshToken?: string
  /** ms since epoch */
  expiresAt?: number
}

export type SolarEdgeTokens = Required<Pick<SolarEdgeCredentials, 'accessToken' | 'refreshToken' | 'expiresAt'>>

export type SolarEdgeErrorKind = 'auth' | 'forbidden' | 'rate' | 'credits' | 'other'

export class SolarEdgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: SolarEdgeErrorKind,
  ) {
    super(message)
  }
}

export function solarEdgeAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_duration: ACCESS_DURATION_MONTHS,
    state,
  })
  return `${AUTHORIZE_URL}?${qs}`
}

async function tokenRequest(body: Record<string, string>, previousRefresh?: string): Promise<SolarEdgeTokens> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const reason = String(data.error_description ?? data.error ?? data.detail ?? `HTTP ${res.status}`)
    const kind: SolarEdgeErrorKind = res.status === 429 ? 'rate' : res.status >= 500 ? 'other' : 'auth'
    throw new SolarEdgeError(`SolarEdge sign-in failed: ${reason}`, res.status, kind)
  }
  const accessToken = String(data.access_token ?? data.accessToken ?? '')
  const refreshToken = String(data.refresh_token ?? data.refreshToken ?? previousRefresh ?? '')
  const expiresIn = Number(data.expires_in ?? data.expiresIn ?? 7200)
  if (!accessToken || !refreshToken) throw new SolarEdgeError('SolarEdge sign-in returned no tokens', res.status, 'other')
  return { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000 }
}

export function solarEdgeExchangeCode(creds: SolarEdgeCredentials, code: string, redirectUri: string) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  })
}

export function solarEdgeRefresh(creds: SolarEdgeCredentials) {
  return tokenRequest(
    { grant_type: 'refresh_token', refresh_token: creds.refreshToken ?? '', client_id: creds.clientId, client_secret: creds.clientSecret },
    creds.refreshToken,
  )
}

async function get<T>(accessToken: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params)
  const res = await fetch(`${API}${path}${qs.size ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })
  if (res.ok) return (await res.json()) as T
  const body = (await res.json().catch(() => ({}))) as { detail?: string; title?: string }
  const detail = body.detail || body.title || `HTTP ${res.status}`
  if (res.status === 401) throw new SolarEdgeError(`SolarEdge: ${detail}`, 401, 'auth')
  if (res.status === 403) throw new SolarEdgeError(`SolarEdge: no access (${detail})`, 403, 'forbidden')
  if (res.status === 429) {
    // Per-minute limit: remaining-minute is 0. Monthly credits used up: remaining-minute is still above 0.
    const remaining = res.headers.get('x-ratelimit-remaining-minute')
    const credits = remaining !== null && remaining.trim() !== '' && remaining.trim() !== '0'
    throw new SolarEdgeError(
      credits ? 'SolarEdge monthly credits used up' : 'SolarEdge per-minute limit hit',
      429,
      credits ? 'credits' : 'rate',
    )
  }
  throw new SolarEdgeError(`SolarEdge ${path}: ${detail}`, res.status, 'other')
}

export async function solarEdgeSite(accessToken: string, siteId: string) {
  const s = await get<{ siteId: number; name?: string; peakPower?: number; status?: string }>(
    accessToken,
    `/sites/${encodeURIComponent(siteId)}`,
  )
  return { siteId: s.siteId, name: s.name ?? null, peakPower: s.peakPower ?? null }
}

const POWER_UNITS: Record<string, number> = { W: 1, KW: 1000, MW: 1_000_000 }

/**
 * Latest 15-minute average PV production in W. from/to are UTC instants (2026-05-01T10:15:00Z);
 * local times without an offset are rejected ("Failed to convert … to required type [Instant]").
 * Returns undefined when SolarEdge has no value yet for the window.
 */
export async function solarEdgePowerW(accessToken: string, siteId: string, from: string, to: string): Promise<number | undefined> {
  const data = await get<{ unit?: string; values?: { timestamp: string; value: number | null }[] }>(
    accessToken,
    `/sites/${encodeURIComponent(siteId)}/power`,
    { resolution: 'QUARTER_HOUR', unit: 'W', from, to },
  )
  const mult = POWER_UNITS[(data.unit ?? 'W').toUpperCase()] ?? 1
  const last = [...(data.values ?? [])].reverse().find((v) => typeof v.value === 'number')
  return last ? Math.max(0, last.value! * mult) : undefined
}
