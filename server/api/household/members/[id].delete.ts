import { removeMember } from '../../../services/household'

/** The member gets a fresh, empty household of their own. */
export default defineEventHandler(async (event) => {
  const { site } = await requireOwner(event)
  await removeMember(useDb(), site.id, Number(getRouterParam(event, 'id')))
  return { ok: true }
})
