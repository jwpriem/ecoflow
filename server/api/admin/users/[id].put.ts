import { updateUser } from '../../../services/admin'

/** Body: any of { experimental, admin, disabled } as booleans. Disabling ends the user's sessions. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  await updateUser(useDb(), admin.id, Number(getRouterParam(event, 'id')), (await readBody(event)) ?? {})
  return { ok: true }
})
