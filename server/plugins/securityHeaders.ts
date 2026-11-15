import { getResponseHeader, setResponseHeader, setResponseHeaders } from 'h3'
import { BASE_CSP, contentSecurityPolicy, cspMode, inlineScriptHashes, SECURITY_HEADERS } from '../lib/csp'

/** Sends the headers from lib/csp.ts on every response; NUXT_CSP_MODE picks report (default), enforce or off */
export default defineNitroPlugin((nitroApp) => {
  const mode = cspMode(process.env.NUXT_CSP_MODE)
  nitroApp.hooks.hook('request', (event) => {
    setResponseHeaders(event, SECURITY_HEADERS)
    setResponseHeader(event, 'Content-Security-Policy', mode === 'enforce' ? contentSecurityPolicy() : BASE_CSP)
    if (mode === 'report') setResponseHeader(event, 'Content-Security-Policy-Report-Only', contentSecurityPolicy())
  })
  // A page rendered now (the app's SPA shell) carries Nuxt's own inline config script: add its hash
  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    if (mode === 'off') return
    const type = String(getResponseHeader(event, 'content-type') ?? '')
    const body = (response as { body?: unknown }).body
    if (!type.includes('text/html') || typeof body !== 'string') return
    const policy = contentSecurityPolicy(inlineScriptHashes(body))
    setResponseHeader(event, mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', policy)
  })
})
