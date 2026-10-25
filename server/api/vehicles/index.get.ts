import { asc, eq } from 'drizzle-orm'
import { vehicles } from '../../db/schema'
import type { VehicleState } from '../../services/zeekr'

/** The cars and their last known reading (vehicles.state is refreshed on every poll). */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const rows = await useDb().select().from(vehicles).where(eq(vehicles.siteId, site.id)).orderBy(asc(vehicles.id))
  return rows.map((v) => ({
    id: v.id,
    vin: v.vin,
    name: v.name,
    model: v.model,
    capacityKwh: v.capacityKwh,
    state: (v.state ?? {}) as Partial<VehicleState>,
  }))
})
