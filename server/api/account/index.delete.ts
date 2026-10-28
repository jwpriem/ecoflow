import { deleteAccount } from '../../services/account'
import { sendEmail } from '../../services/email'
import { verifyPassword } from '../../utils/crypto'

/** Body: { password }. Deletes the account, and for the owner the whole household. Immediate, no grace period. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit([LIMITS.passwordUser, String(user.id)])
  const body = await readBody<{ password?: string }>(event)
  if (!(await verifyPassword(String(body?.password ?? ''), user.passwordHash))) {
    throw createError({ statusCode: 400, statusMessage: 'The password is wrong' })
  }
  const { household, members } = await deleteAccount(useDb(), user.id)
  if (household) {
    for (const m of members) await sendEmail(m.email, 'householdDeleted', { household: household.name }, m.locale)
    console.info(`[account] user ${user.id} deleted with household ${household.id} (${members.length} members moved out)`)
  } else console.info(`[account] user ${user.id} deleted`)
  return { ok: true }
})
