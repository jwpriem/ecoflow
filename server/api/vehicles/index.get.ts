import { and, asc, eq } from 'drizzle-orm'
import { integrations, vehicles } from '../../db/schema'
import type { TibberAppMeta } from '../../services/tibberEv'
import type { VehicleState } from '../../services/zeekr'

/** The cars and their last known reading (vehicles.state is refreshed on every poll). */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const db = useDb()
  const rows = await db.select().from(vehicles).where(eq(vehicles.siteId, site.id)).orderBy(asc(vehicles.id))
  const [tibber] = await db
    .select({ meta: integrations.meta })
    .from(integrations)
    .where(and(eq(integrations.siteId, site.id), eq(integrations.provider, 'tibber_app')))
  const meta = (tibber?.meta ?? {}) as TibberAppMeta
  const map = meta.map ?? {}
  return rows.map((v) => ({
    id: v.id,
    vin: v.vin,
    name: v.name,
    model: v.model,
    capacityKwh: v.capacityKwh,
    tibberVehicleId: map[v.id] ?? null,
    /** The departure last set from WattsWise */
    departure: meta.departures?.[v.id] ?? null,
    state: (v.state ?? {}) as Partial<VehicleState>,
  }))
})
