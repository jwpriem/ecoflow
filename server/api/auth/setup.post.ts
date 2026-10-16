import { count } from 'drizzle-orm'
import { users } from '../../db/schema'
import { createAccount } from '../../services/setup'

/** First-run: create the (only) account. Disabled as soon as a user exists. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string; siteName?: string }>(event)
  if (!body?.email || !body.password || body.password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Email and a password of at least 8 characters are required' })
  }
  const db = useDb()
  const [row] = await db.select({ n: count() }).from(users)
  if ((row?.n ?? 0) > 0) throw createError({ statusCode: 403, statusMessage: 'Setup already done' })
  const { user } = await createAccount(db, body.email, body.password, body.siteName || 'Home')
  return createSession(user.id, getHeader(event, 'user-agent'))
})
