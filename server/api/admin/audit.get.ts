import { recentAudit } from '../../services/admin'

/** The latest admin actions. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return recentAudit(useDb())
})
