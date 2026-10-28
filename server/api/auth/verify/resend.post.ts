import { sendVerification } from '../../../services/verify'

/** Sends the logged-in user a new verification link, unless the address is verified already. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (user.emailVerifiedAt) return { ok: true, verified: true }
  rateLimit([LIMITS.verifyResendUser, String(user.id)])
  const r = await sendVerification(useDb(), user, appBaseUrl(event))
  if (!r.ok) throw createError({ statusCode: 502, statusMessage: 'The email could not be sent, try again later' })
  return { ok: true, verified: false }
})
