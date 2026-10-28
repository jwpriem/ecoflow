import { sendEmail } from '../../services/email'
import { normalizeEmail, signUp } from '../../services/setup'

/**
 * Body: { email, password, locale, acceptTerms }. Creates the account, a household that only monitors, and the
 * owner membership. Answers { ok: true } whether or not the email was already registered, so this can't be used
 * to find out who has an account: the app logs in next, and the owner of an existing address gets an email instead.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  rateLimit([LIMITS.signupIp, clientIp(event)], [LIMITS.signupEmail, normalizeEmail(String(body?.email ?? ''))])
  const { created, user, locale } = await signUp(useDb(), body ?? {})
  if (!created) {
    const base = String(useRuntimeConfig().appUrl || '') || getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
    await sendEmail(user.email, 'accountExists', { loginUrl: `${base}/login`, resetUrl: `${base}/reset` }, user.locale ?? locale)
  }
  return { ok: true }
})
