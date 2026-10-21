import { and, eq } from 'drizzle-orm'
import { devices } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const id = Number(getRouterParam(event, 'id'))
  const b = await readBody<Partial<typeof devices.$inferInsert>>(event)
  const update: Partial<typeof devices.$inferInsert> = {}
  if (typeof b.name === 'string' && b.name.trim()) update.name = b.name.trim().slice(0, 60)
  if (typeof b.serial === 'string' && b.serial.trim()) update.serial = b.serial.trim()
  if (b.driver === 'ecoflow_official') update.driver = b.driver
  for (const k of ['capacityWh', 'maxChargeW', 'maxDischargeW'] as const) {
    if (b[k] !== undefined) {
      const n = Math.round(Number(b[k]))
      if (!Number.isFinite(n) || n <= 0 || n > 20000) throw createError({ statusCode: 400, statusMessage: `Bad ${k}` })
      update[k] = n
    }
  }
  const [row] = await useDb().update(devices).set(update).where(and(eq(devices.id, id), eq(devices.siteId, site.id))).returning()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Device not found' })
  return row
})
