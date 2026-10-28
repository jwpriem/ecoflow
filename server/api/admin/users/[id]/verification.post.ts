import { audit, targetUser } from '../../../../services/admin'
import { sendVerification } from '../../../../services/verify'

/** Sends the user a new verification link. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const db = useDb()
  const user = await targetUser(db, Number(getRouterParam(event, 'id')))
  if (user.emailVerifiedAt) throw createError({ statusCode: 400, statusMessage: 'This address is already verified' })
  const r = await sendVerification(db, user, appBaseUrl(event))
  if (!r.ok) throw createError({ statusCode: 502, statusMessage: 'The email could not be sent, try again later' })
  await audit(db, admin.id, 'user.verificationSent', user.id)
  return { ok: true }
})
