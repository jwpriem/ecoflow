/**
 * Takes personal data and secrets out of an error report before it leaves the server or the phone. Used as
 * Sentry's beforeSend/beforeBreadcrumb on both sides. Errors only need the stack, the route and the
 * household's number; everything else is either dropped or masked.
 */

const REDACTED = '[redacted]'

/**
 * Sentry's own collection, turned off before the scrubber even runs: no user fields, cookies, headers, bodies,
 * query strings, GraphQL variables (Tibber), database parameters or local variables from stack frames.
 */
export const NO_PERSONAL_DATA = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as never[],
  urlQueryParams: false,
  graphQL: { document: true, variables: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
}

/** Field names whose value is never sent, whatever it looks like */
const SECRET_KEYS = new Set([
  'password', 'currentpassword', 'newpassword', 'secret', 'secretkey', 'accesskey', 'apikey', 'api_key', 'key', 'token', 'accesstoken',
  'access_token', 'refreshtoken', 'refresh_token', 'authorization', 'cookie', 'set-cookie', 'session', 'sign', 'nonce', 'auth', 'p256dh',
  'endpoint', 'credentials', 'credentialsenc', 'credentials_enc', 'email', 'username', 'clientsecret', 'client_secret',
  'certificatepassword', 'ip_address',
])
const SECRET_KEY_PART = /secret|token|password|credential|apikey|api_key|accesskey|cookie|authorization/i

export const isSecretKey = (key: string) => SECRET_KEYS.has(key.toLowerCase()) || SECRET_KEY_PART.test(key)
/** In a URL `code` and `state` are the OAuth hand-over (SolarEdge); elsewhere `code` is a harmless error code */
const SECRET_QUERY_KEYS = new Set(['code', 'state'])

const STRING_RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b(Bearer|Basic)\s+[^\s"',;]+/gi, `$1 ${REDACTED}`],
  // key=value and "key": "value" with a secret-looking key
  [/(["']?)([A-Za-z_-]*(?:password|secret|token|key|sign|auth|nonce)[A-Za-z_-]*)\1(\s*[:=]\s*)(["']?)[^\s"'&,;}]+\4/gi, (_m, q, k, sep, vq) => `${q}${k}${q}${sep}${vq}${REDACTED}${vq}`],
  // The OAuth hand-over in a URL inside a message
  [/([?&](?:code|state)=)[^&\s"']+/gi, `$1${REDACTED}`],
  // JWTs, and long opaque runs (keys, tokens, hex and base64 blobs)
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  [/[A-Za-z0-9_+=-]{32,}/g, REDACTED],
]

export function scrubString(s: string): string {
  let out = s
  for (const [re, to] of STRING_RULES) out = out.replace(re, to as string)
  return out
}

/** Every string masked and every secret-named field dropped, at any depth */
export function scrubValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return scrubString(v)
  if (!v || typeof v !== 'object' || depth > 12) return v
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = isSecretKey(k) ? REDACTED : scrubValue(x, depth + 1)
  return out
}

/** The parts of a Sentry event this touches; the rest (ids, timestamps, SDK info) goes out unchanged */
export interface ScrubbableEvent {
  message?: string
  exception?: unknown
  breadcrumbs?: unknown[]
  extra?: Record<string, unknown>
  tags?: Record<string, unknown>
  user?: Record<string, unknown>
  request?: { url?: string; query_string?: unknown; headers?: Record<string, string>; data?: unknown; cookies?: unknown; env?: unknown }
  contexts?: Record<string, unknown>
}

const SAFE_HEADERS = new Set(['content-type', 'accept', 'user-agent', 'accept-language', 'content-length'])

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.message) event.message = scrubString(event.message)
  if (event.exception) event.exception = scrubValue(event.exception)
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((b) => scrubValue(b))
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>
  if (event.tags) event.tags = scrubValue(event.tags) as Record<string, unknown>
  // Only the user's number, never an email or IP address
  if (event.user) event.user = event.user.id !== undefined ? { id: event.user.id } : {}
  if (event.request) {
    const r = event.request
    // Request bodies carry passwords, API keys and addresses (sign-in, connections, invites): never sent
    delete r.data
    delete r.cookies
    delete r.env
    if (r.headers) r.headers = Object.fromEntries(Object.entries(r.headers).filter(([k]) => SAFE_HEADERS.has(k.toLowerCase())))
    if (r.url) r.url = scrubUrl(r.url)
    if (r.query_string !== undefined) r.query_string = typeof r.query_string === 'string' ? scrubQuery(r.query_string) : scrubValue(r.query_string)
  }
  if (event.contexts) {
    const { trace, ...rest } = event.contexts
    event.contexts = { ...(scrubValue(rest) as Record<string, unknown>), ...(trace ? { trace } : {}) }
  }
  return event
}

function scrubQuery(q: string): string {
  return q
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const [k = '', v = ''] = pair.split('=')
      const name = decodeURIComponent(k)
      return `${k}=${isSecretKey(name) || SECRET_QUERY_KEYS.has(name.toLowerCase()) ? REDACTED : scrubString(v)}`
    })
    .join('&')
}

function scrubUrl(url: string): string {
  const i = url.indexOf('?')
  return i < 0 ? scrubString(url) : `${scrubString(url.slice(0, i))}?${scrubQuery(url.slice(i + 1))}`
}
