import { createInvite, revokeInvite } from '../../../services/household'
import { sendEmail } from '../../../services/email'
import { assertVerified } from '../../../services/verify'

/** Body: { email }. Emails an invitation to join this household, valid for 7 days. */
export default defineEventHandler(async (event) => {
  const { user, site } = await requireOwner(event)
  assertVerified(user)
  rateLimit([LIMITS.inviteUser, String(user.id)])
  const body = await readBody<{ email?: string }>(event)
  const db = useDb()
  const { invite, token } = await createInvite(db, { siteId: site.id, invitedBy: user.id, email: body?.email })
  const url = `${appBaseUrl(event)}/invite?token=${encodeURIComponent(token)}`
  const sent = await sendEmail(invite.email, 'invite', { url, inviter: user.email, household: site.name }, user.locale)
  if (!sent.ok) {
    await revokeInvite(db, site.id, invite.id)
    throw createError({ statusCode: 502, statusMessage: 'The email could not be sent, try again later' })
  }
  return invite
})
