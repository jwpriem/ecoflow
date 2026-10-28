import type { H3Event } from 'h3'

/** The app's public URL for links in emails: NUXT_APP_URL, else the address this request came in on. */
export function appBaseUrl(event: H3Event): string {
  return (String(useRuntimeConfig().appUrl || '') || getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin).replace(/\/$/, '')
}
