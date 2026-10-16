import { count } from 'drizzle-orm'
import { users } from '../../db/schema'

export default defineEventHandler(async () => {
  const [row] = await useDb().select({ n: count() }).from(users)
  return { needsSetup: (row?.n ?? 0) === 0 }
})
