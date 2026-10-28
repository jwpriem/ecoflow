import { sendEmail } from '../../services/email'
import { normalizeEmail, signUp } from '../../services/setup'
import { sendVerification } from '../../services/verify'

/**
 * Body: { email, password, locale, acceptTerms }. Creates the account, a household that only monitors, and the
 * owner membership, and emails the link that verifies the address. Answers { ok: true } whether or not the email was already registered, so this can't be used
 * to find out who has an account: the app logs in next, and the owner of an existing address gets an email instead.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  rateLimit([LIMITS.signupIp, clientIp(event)], [LIMITS.signupEmail, normalizeEmail(String(body?.email ?? ''))])
  const { created, user } = await signUp(useDb(), body ?? {})
  const base = appBaseUrl(event)
  if (created) await sendVerification(useDb(), user, base)
  else await sendEmail(user.email, 'accountExists', { loginUrl: `${base}/login`, resetUrl: `${base}/reset` }, user.locale)
  return { ok: true }
})
