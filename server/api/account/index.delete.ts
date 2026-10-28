import { deleteAccountAndTell } from '../../services/account'
import { verifyPassword } from '../../utils/crypto'

/** Body: { password }. Deletes the account, and for the owner the whole household. Immediate, no grace period. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit([LIMITS.passwordUser, String(user.id)])
  const body = await readBody<{ password?: string }>(event)
  if (!(await verifyPassword(String(body?.password ?? ''), user.passwordHash))) {
    throw createError({ statusCode: 400, statusMessage: 'The password is wrong' })
  }
  const { household, members } = await deleteAccountAndTell(useDb(), user.id)
  console.info(`[account] user ${user.id} deleted${household ? ` with household ${household.id} (${members.length} members moved out)` : ''}`)
  return { ok: true }
})
