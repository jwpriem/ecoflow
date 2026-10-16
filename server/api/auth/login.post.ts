import { eq } from 'drizzle-orm'
import { users } from '../../db/schema'
import { verifyPassword } from '../../utils/crypto'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event)
  const email = body?.email?.toLowerCase().trim() ?? ''
  const [user] = await useDb().select().from(users).where(eq(users.email, email))
  if (!user || !(await verifyPassword(body?.password ?? '', user.passwordHash))) {
    throw createError({ statusCode: 401, statusMessage: 'Wrong email or password' })
  }
  return createSession(user.id, getHeader(event, 'user-agent'))
})
