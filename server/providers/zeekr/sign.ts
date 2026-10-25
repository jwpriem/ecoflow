import { constants, createCipheriv, createHash, createHmac, createPublicKey, publicEncrypt, randomUUID } from 'node:crypto'

/**
 * Request signing for the Zeekr app API, ported from the community Python client
 * (github.com/Fryyyyy/zeekr_ev_api). Two schemes are used:
 *
 *  - HMAC (`hmacHeaders`): the login / user-center calls that carry DEFAULT_HEADERS.
 *    Signs method, path, query, access key and a GMT date with the HMAC secret key.
 *  - App signature (`appSignatureHeaders`): the bearer-token calls (vehicle list and
 *    status). Signs the allowed headers, query, JSON body MD5, method and path with
 *    the prod secret.
 *
 * The RSA (login password) and AES-CBC (VIN) helpers match the app's own crypto:
 * the VIN key and IV are used as raw UTF-8 bytes, not hex-decoded.
 */

export function hmacSha256Base64(data: string, key: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('base64')
}

function canonicalPath(pathname: string): string {
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  return segments.length ? '/' + segments.join('/') : '/'
}

function canonicalQuery(search: string): string {
  const q = search.startsWith('?') ? search.slice(1) : search
  if (!q) return ''
  const map: Record<string, string> = {}
  for (const pair of q.split('&')) {
    const i = pair.indexOf('=')
    if (i >= 0) map[pair.slice(0, i)] = pair.slice(i + 1)
  }
  return Object.keys(map)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k}=${map[k]}`)
    .join('&')
}

/** GMT date in the format the gateway expects, e.g. "Mon, 25 Oct 2026 11:50:00 GMT". */
export function gmtDate(now = new Date()): string {
  return now.toUTCString()
}

/** Headers for an HMAC-signed request (login / user-center flow). */
export function hmacHeaders(
  method: string,
  url: string,
  body: string,
  accessKey: string,
  secretKey: string,
  now = new Date(),
): Record<string, string> {
  const u = new URL(url)
  const date = gmtDate(now)
  const signString = [method.toUpperCase(), canonicalPath(u.pathname), canonicalQuery(u.search), accessKey, date].join('\n')
  const signature = hmacSha256Base64(signString + '\n', secretKey)
  const digest = hmacSha256Base64(body ?? '', secretKey)
  return {
    'X-HMAC-ALGORITHM': 'hmac-sha256',
    'X-HMAC-SIGNATURE': signature,
    'X-HMAC-ACCESS-KEY': accessKey,
    'X-HMAC-DIGEST': digest,
    'X-DATE': date,
  }
}

const ALLOWED_HEADERS = new Set([
  'x-app-id',
  'content-type',
  'x-api-signature-nonce',
  'x-timestamp',
  'x-api-signature-version',
  'x-project-id',
  'authorization',
  'accept-language',
  'x-vin',
  'x-device-id',
  'x-platform',
])

/** JSON serialised with keys sorted at every level and no whitespace (matches Gson canonicalisation). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}'
}

function queryStringForSig(search: string): string {
  const q = search.startsWith('?') ? search.slice(1) : search
  if (!q) return ''
  const map: Record<string, string> = {}
  for (const pair of q.split('&')) {
    const i = pair.indexOf('=')
    const key = i >= 0 ? pair.slice(0, i) : pair
    const raw = i >= 0 ? pair.slice(i + 1) : ''
    map[key] = decodeURIComponent(raw)
  }
  return Object.keys(map)
    .sort()
    .map((k) => {
      const value = map[k]!.replace(/%2F/g, '/').replace(/%3F/g, '?').replace(/\*/g, '%2A')
      return `${k}=${value}`
    })
    .join('&')
}

/**
 * Builds the X-SIGNATURE header for a bearer-token (app-signed) request, filling in
 * the nonce and timestamp if the caller did not set them. Returns the full header set.
 */
export function appSignatureHeaders(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  prodSecret: string,
  nonce = randomUUID(),
  timestampMs = Date.now(),
): Record<string, string> {
  const out: Record<string, string> = { ...headers }
  // Case-insensitive presence check for the nonce / timestamp
  const lower = new Map(Object.keys(out).map((k) => [k.toLowerCase(), k]))
  if (!lower.has('x-api-signature-nonce')) out['X-API-SIGNATURE-NONCE'] = nonce
  if (!lower.has('x-timestamp')) out['X-TIMESTAMP'] = String(timestampMs)

  const u = new URL(url)

  // Canonical headers: allowed keys only, authorization and x-vin must be non-empty, sorted by key
  const canonicalHeaders = Object.entries(out)
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .filter(([k, v]) => {
      if (!ALLOWED_HEADERS.has(k)) return false
      if (k === 'x-vin' || k === 'authorization') return !!v
      return true
    })
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}:${v}\n`)
    .join('')

  const query = queryStringForSig(u.search)

  let bodyHash = ''
  const contentType = (out['Content-Type'] ?? out['content-type'] ?? '').toLowerCase()
  if (contentType.includes('application/json') && body) {
    try {
      const md5 = createHash('md5').update(canonicalJson(JSON.parse(body)), 'utf8').digest()
      bodyHash = md5.toString('base64')
    } catch {
      // non-JSON body despite the header: leave the hash out, as the reference does
    }
  }

  let base = canonicalHeaders
  if (query) base += query + '\n'
  if (bodyHash) base += bodyHash + '\n'
  base += method.toUpperCase() + '\n' + u.pathname

  out['X-SIGNATURE'] = hmacSha256Base64(base, prodSecret)
  return out
}

/** RSA PKCS#1 v1.5 encrypt the login password with the app's base64 SPKI public key. */
export function encryptPassword(password: string, publicKeyB64: string): string {
  const der = Buffer.from(publicKeyB64, 'base64')
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
  const encrypted = publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(password, 'utf8'))
  return encrypted.toString('base64')
}

/** AES-128-CBC encrypt the VIN. The key and IV are used as raw UTF-8 bytes (not hex-decoded). */
export function encryptVin(vin: string, vinKey: string, vinIv: string): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(vinKey, 'utf8'), Buffer.from(vinIv, 'utf8'))
  return Buffer.concat([cipher.update(vin, 'utf8'), cipher.final()]).toString('base64')
}
