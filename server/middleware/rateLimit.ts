import { createHash } from 'node:crypto'

/** Not counted here: the health check, Google's Nest pushes (many per ring, from Google's addresses), and CSP reports (own limit) */
const EXEMPT = new Set(['/api/auth/status', '/api/integrations/nest/events', '/api/csp-report'])

/**
 * A ceiling on every API request, per session and per address (utils/limits.ts: apiSession, apiIp), on top of the
 * tighter limits on login, sign-up, resets and the buttons that reach out. Far above normal use: it stops a script
 * or a stuck client from wearing out the server and the providers' quotas.
 */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/') || event.method === 'OPTIONS') return
  if (EXEMPT.has(event.path.split('?')[0]!)) return
  const ip = clientIp(event)
  const auth = getHeader(event, 'authorization') ?? ''
  const session = auth.startsWith('Bearer ') ? `s:${createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 32)}` : `ip:${ip}`
  rateLimit([LIMITS.apiSession, session], [LIMITS.apiIp, ip])
})
