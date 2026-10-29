import { demoUser } from '../../services/demo'

/** Days a "Try the demo" session lasts: enough to look around, short enough not to pile up */
const DEMO_SESSION_DAYS = 1

/**
 * "Try the demo": a short session for the shared demo account, no password needed. Everything in it is
 * read-only (assertNotDemo). Apple's reviewer can still log in with the demo's email and password.
 */
export default defineEventHandler(async (event) => {
  rateLimit([LIMITS.demoIp, clientIp(event)])
  const user = await demoUser(useDb())
  if (!user) throw createError({ statusCode: 404, statusMessage: 'The demo is not available right now' })
  return createSession(user.id, getHeader(event, 'user-agent'), DEMO_SESSION_DAYS)
})
