import { and, eq } from 'drizzle-orm'
import { vehicles } from '../../db/schema'
import { getIntegration, updateIntegration } from '../../services/integrations'
import type { TibberAppMeta } from '../../services/tibberEv'

/**
 * Rename a car, set its usable battery capacity (used later to estimate charging need), or pick
 * which car in the Tibber app it is (tibberVehicleId, null to stop sending its level to Tibber).
 */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const id = Number(getRouterParam(event, 'id'))
  const b = await readBody<{ name?: string; capacityKwh?: number | null; tibberVehicleId?: string | null }>(event)
  const update: Partial<typeof vehicles.$inferInsert> = {}
  if (typeof b.name === 'string' && b.name.trim()) update.name = b.name.trim().slice(0, 60)
  if (b.capacityKwh === null) update.capacityKwh = null
  else if (b.capacityKwh !== undefined) {
    const n = Number(b.capacityKwh)
    if (!Number.isFinite(n) || n <= 0 || n > 300) throw createError({ statusCode: 400, statusMessage: 'Bad capacityKwh' })
    update.capacityKwh = n
  }
  const db = useDb()
  const [row] = Object.keys(update).length
    ? await db.update(vehicles).set(update).where(and(eq(vehicles.id, id), eq(vehicles.siteId, site.id))).returning()
    : await db.select().from(vehicles).where(and(eq(vehicles.id, id), eq(vehicles.siteId, site.id)))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Car not found' })

  if (b.tibberVehicleId !== undefined) {
    const key = encryptionKey()
    const integ = await getIntegration(db, site.id, 'tibber_app', key)
    if (!integ) throw createError({ statusCode: 400, statusMessage: 'Tibber app is not connected' })
    const meta = (integ.meta ?? {}) as TibberAppMeta
    const map = { ...(meta.map ?? {}) }
    if (b.tibberVehicleId === null || b.tibberVehicleId === '') delete map[row.id]
    else if (meta.vehicles?.some((v) => v.id === b.tibberVehicleId)) map[row.id] = b.tibberVehicleId
    else throw createError({ statusCode: 400, statusMessage: 'Unknown Tibber car' })
    await updateIntegration(db, integ.row.id, { meta: { ...meta, map } as Record<string, unknown> }, key)
  }
  return row
})
