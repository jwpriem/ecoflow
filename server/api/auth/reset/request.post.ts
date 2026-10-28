import { sendEmail } from '../../../services/email'
import { requestReset } from '../../../services/passwords'
import { normalizeEmail } from '../../../services/setup'

/** Body: { email }. Always { ok: true }, so this doesn't reveal which addresses have an account. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)
  const email = normalizeEmail(String(body?.email ?? ''))
  rateLimit([LIMITS.resetIp, clientIp(event)], [LIMITS.resetEmail, email])
  const reset = await requestReset(useDb(), email)
  if (reset) {
    await sendEmail(reset.user.email, 'reset', { url: `${appBaseUrl(event)}/reset?token=${encodeURIComponent(reset.token)}` }, reset.user.locale)
  }
  return { ok: true }
})
