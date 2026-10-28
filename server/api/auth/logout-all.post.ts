import { logOutEverywhere } from '../../services/passwords'

/** Ends every session of this user, this one included. */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await logOutEverywhere(useDb(), user.id)
  return { ok: true }
})
