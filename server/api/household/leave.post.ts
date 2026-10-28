import { leaveHousehold } from '../../services/household'

/** A member leaves and gets a fresh, empty household of their own. The owner can't. */
export default defineEventHandler(async (event) => {
  const { user } = await requireSite(event)
  await leaveHousehold(useDb(), user.id)
  return { ok: true }
})
