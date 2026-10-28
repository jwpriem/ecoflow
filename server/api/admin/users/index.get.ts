import { listUsers } from '../../../services/admin'

/** Query: q (email search), page (from 0). */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { q, page } = getQuery(event)
  return listUsers(useDb(), String(q ?? '').trim(), page)
})
