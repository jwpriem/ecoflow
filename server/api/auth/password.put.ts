import { changePassword } from '../../services/passwords'

/** Body: { current, password }. Keeps this session, ends all others. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit([LIMITS.passwordUser, String(user.id)])
  const body = await readBody<{ current?: string; password?: string }>(event)
  await changePassword(useDb(), user.id, user.sessionId, body?.current, body?.password)
  return { ok: true }
})
