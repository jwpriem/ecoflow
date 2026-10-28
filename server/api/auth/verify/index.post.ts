import { verifyEmail } from '../../../services/verify'

/** Body: { token } from the link in the verification email. No login needed: the link may open on another device. */
export default defineEventHandler(async (event) => {
  rateLimit([LIMITS.verifyIp, clientIp(event)])
  const body = await readBody<{ token?: string }>(event)
  await verifyEmail(useDb(), String(body?.token ?? ''))
  return { ok: true }
})
