import { inviteDetails } from '../../services/household'

/** Body: { token }. Who invites to which household, and whether the address has an account. No login needed. */
export default defineEventHandler(async (event) => {
  rateLimit([LIMITS.inviteIp, clientIp(event)])
  const body = await readBody<{ token?: string }>(event)
  return inviteDetails(useDb(), String(body?.token ?? ''))
})
