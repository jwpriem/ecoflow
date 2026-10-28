import { listHouseholds } from '../../../services/admin'

/** Query: q (household name or a member's email), page (from 0). */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { q, page } = getQuery(event)
  return listHouseholds(useDb(), String(q ?? '').trim(), page)
})
