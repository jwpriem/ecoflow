import { revokeInvite } from '../../../services/household'

export default defineEventHandler(async (event) => {
  const { site } = await requireOwner(event)
  await revokeInvite(useDb(), site.id, Number(getRouterParam(event, 'id')))
  return { ok: true }
})
