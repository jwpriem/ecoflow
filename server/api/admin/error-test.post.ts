import { reportTestEvent } from '../../services/errors'

/** Sends one test event to the error tracker, to check reports arrive. Admins only. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { sent: reportTestEvent('server') }
})
