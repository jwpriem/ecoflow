import { eq } from 'drizzle-orm'
import { users } from '../../db/schema'
import { normalizeEmail } from '../../services/setup'
import { verifyPassword } from '../../utils/crypto'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event)
  const email = normalizeEmail(body?.email ?? '')
  rateLimit([LIMITS.loginIp, clientIp(event)], [LIMITS.loginEmail, email])
  const [user] = await useDb().select().from(users).where(eq(users.email, email))
  if (!user || !(await verifyPassword(body?.password ?? '', user.passwordHash))) {
    throw createError({ statusCode: 401, statusMessage: 'Wrong email or password' })
  }
  LIMITS.loginEmail.reset(email)
  return createSession(user.id, getHeader(event, 'user-agent'))
})
