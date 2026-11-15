import { setResponseHeaders } from 'h3'

/**
 * Baseline security headers on every response: pages, static files and the API.
 * - HSTS: browsers only use https for a year (no includeSubDomains: other subdomains of wattswise.eu are not ours to decide)
 * - nosniff: an uploaded doorbell sound or JSON is never run as a script or page
 * - frame-ancestors / X-Frame-Options: the app can't be framed (clickjacking)
 * - Referrer-Policy: links out carry only our origin, never a path with a token in it (/reset?token=…)
 * - Permissions-Policy: the app needs no camera, microphone or location of its own
 * A full Content-Security-Policy is not set here yet: see security-report.md (the inline SKY_BOOT script and Sentry need care).
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    setResponseHeaders(event, SECURITY_HEADERS)
  })
})
