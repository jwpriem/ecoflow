import { eq } from 'drizzle-orm'
import { users } from '../../db/schema'
import { normalizeEmail } from '../../services/setup'
import { securityEvents } from '../../lib/securityEvents'
import { dummyPasswordHash, verifyPassword } from '../../utils/crypto'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event)
  const email = normalizeEmail(body?.email ?? '')
  rateLimit([LIMITS.loginIp, clientIp(event)], [LIMITS.loginEmail, email])
  const [user] = await useDb().select().from(users).where(eq(users.email, email))
  // No account: still run scrypt, so the response time doesn't tell which addresses have one
  const ok = await verifyPassword(String(body?.password ?? ''), user?.passwordHash ?? (await dummyPasswordHash()))
  if (!user || !ok) {
    securityEvents.record('loginFailed')
    throw createError({ statusCode: 401, statusMessage: 'Wrong email or password' })
  }
  if (user.disabledAt) throw createError({ statusCode: 403, statusMessage: 'This account is disabled' })
  LIMITS.loginEmail.reset(email)
  return createSession(user.id, getHeader(event, 'user-agent'))
})
