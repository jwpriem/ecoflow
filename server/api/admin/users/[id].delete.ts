import { deleteAccountAndTell } from '../../../services/account'
import { audit, targetUser } from '../../../services/admin'

/** Deletes the user as account deletion does: an owner takes the household with them, members move out. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (id === admin.id) throw createError({ statusCode: 400, statusMessage: 'Delete your own account from Settings' })
  const db = useDb()
  await targetUser(db, id)
  const { household, members } = await deleteAccountAndTell(db, id)
  await audit(db, admin.id, 'user.deleted', id, { householdId: household?.id ?? null, membersMovedOut: members.length })
  return { ok: true }
})
