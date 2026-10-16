import { eq } from 'drizzle-orm'
import { sessions } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await useDb().delete(sessions).where(eq(sessions.id, user.sessionId))
  return { ok: true }
})
