import { signUpWithInvite } from '../../services/household'

/** Body: { token, password, locale, acceptTerms }. A new account in the household, logged in straight away. */
export default defineEventHandler(async (event) => {
  rateLimit([LIMITS.inviteIp, clientIp(event)])
  const user = await signUpWithInvite(useDb(), (await readBody<Record<string, unknown>>(event)) ?? {})
  return createSession(user.id, getHeader(event, 'user-agent'))
})
