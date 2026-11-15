import { createHash } from 'node:crypto'
import { SITE_BOOT } from '../../app/utils/site'
import { SKY_BOOT } from '../../app/utils/skyBoot'

/**
 * Baseline security headers on every response: pages, static files and the API.
 * - HSTS: browsers only use https for a year (no includeSubDomains: other subdomains of wattswise.eu are not ours to decide)
 * - nosniff: an uploaded doorbell sound or JSON is never run as a script or page
 * - frame-ancestors / X-Frame-Options: the app can't be framed (clickjacking)
 * - Referrer-Policy: links out carry only our origin, never a path with a token in it (/reset?token=…)
 * - Permissions-Policy: the app needs no camera, microphone or location of its own
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}

/** Always enforced, whatever the CSP mode: these break nothing the app does */
export const BASE_CSP = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"

export const CSP_REPORT_PATH = '/api/csp-report'

const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`

/** The inline scripts every page may carry: the sky and website boot scripts (also in the prerendered pages) */
const STATIC_HASHES = [sha(SKY_BOOT), sha(SITE_BOOT)]

/** Inline <script> bodies CSP checks (code and import maps, not JSON data blocks), for a page rendered now */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? ''
    if (/\bsrc\s*=/i.test(attrs)) continue
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase()
    // An import map counts as an inline script for CSP; JSON data blocks don't run
    if (type && !['module', 'importmap', 'text/javascript', 'application/javascript'].includes(type)) continue
    if (m[2]) out.push(sha(m[2]))
  }
  return out
}

/**
 * The full policy. Scripts only from us plus the hashed inline boot scripts; styles allow inline (Vue binds style
 * attributes everywhere); connections to us and Sentry (EU). Images allow https: for provider images (cars, cameras).
 */
export function contentSecurityPolicy(scriptHashes: string[] = []): string {
  const hashes = [...new Set([...STATIC_HASHES, ...scriptHashes])].join(' ')
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self' https://*.ingest.de.sentry.io https://*.sentry.io",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    BASE_CSP,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ')
}

export type CspMode = 'off' | 'report' | 'enforce'

/** NUXT_CSP_MODE: 'report' (default) only reports violations, 'enforce' blocks them, 'off' sends only the base policy */
export function cspMode(value: unknown): CspMode {
  return value === 'enforce' || value === 'off' ? value : 'report'
}
