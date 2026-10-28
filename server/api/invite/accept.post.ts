import { joinHousehold } from '../../services/household'

/** Body: { token, confirm }. The logged-in user joins as a member; a 409 with data.confirm asks to confirm first. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit([LIMITS.inviteIp, clientIp(event)])
  const body = await readBody<{ token?: string; confirm?: boolean }>(event)
  await joinHousehold(useDb(), user, String(body?.token ?? ''), body?.confirm === true)
  return { ok: true }
})
