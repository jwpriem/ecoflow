import { eq } from 'drizzle-orm'
import { sites } from '../../db/schema'

/** Body: { name }. Renames the household. Owner only. */
export default defineEventHandler(async (event) => {
  const { site } = await requireOwner(event)
  const { name } = await readBody<{ name?: string }>(event)
  const n = typeof name === 'string' ? name.trim().slice(0, 60) : ''
  if (!n) throw createError({ statusCode: 400, statusMessage: 'Give the household a name' })
  const [updated] = await useDb().update(sites).set({ name: n }).where(eq(sites.id, site.id)).returning()
  return { name: updated!.name }
})
