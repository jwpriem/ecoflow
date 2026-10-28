import { confirmReset } from '../../../services/passwords'

/** Body: { token, password }. Sets the password and logs the account out everywhere; the app then logs in again. */
export default defineEventHandler(async (event) => {
  rateLimit([LIMITS.resetConfirmIp, clientIp(event)])
  const body = await readBody<{ token?: string; password?: string }>(event)
  await confirmReset(useDb(), String(body?.token ?? ''), body?.password)
  return { ok: true }
})
