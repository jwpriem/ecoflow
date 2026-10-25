import { and, eq } from 'drizzle-orm'
import { vehicles } from '../../db/schema'

/** Rename a car or set its usable battery capacity (used later to estimate charging need). */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const id = Number(getRouterParam(event, 'id'))
  const b = await readBody<{ name?: string; capacityKwh?: number | null }>(event)
  const update: Partial<typeof vehicles.$inferInsert> = {}
  if (typeof b.name === 'string' && b.name.trim()) update.name = b.name.trim().slice(0, 60)
  if (b.capacityKwh === null) update.capacityKwh = null
  else if (b.capacityKwh !== undefined) {
    const n = Number(b.capacityKwh)
    if (!Number.isFinite(n) || n <= 0 || n > 300) throw createError({ statusCode: 400, statusMessage: 'Bad capacityKwh' })
    update.capacityKwh = n
  }
  const [row] = await useDb().update(vehicles).set(update).where(and(eq(vehicles.id, id), eq(vehicles.siteId, site.id))).returning()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Car not found' })
  return row
})
