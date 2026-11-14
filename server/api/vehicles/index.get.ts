import { and, asc, eq } from 'drizzle-orm'
import { integrations, vehicles } from '../../db/schema'
import { assertExperimental } from '../../services/experimental'
import type { AbrpCredentials, AbrpMeta } from '../../services/abrp'
import { getIntegration } from '../../services/integrations'
import type { TibberAppMeta } from '../../services/tibberEv'
import type { VehicleState } from '../../services/zeekr'

/** The cars and their last known reading (vehicles.state is refreshed on every poll). */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const db = useDb()
  const rows = await db.select().from(vehicles).where(eq(vehicles.siteId, site.id)).orderBy(asc(vehicles.id))
  const [tibber] = await db
    .select({ meta: integrations.meta })
    .from(integrations)
    .where(and(eq(integrations.siteId, site.id), eq(integrations.provider, 'tibber_app')))
  const [abrp] = await db
    .select({ meta: integrations.meta })
    .from(integrations)
    .where(and(eq(integrations.siteId, site.id), eq(integrations.provider, 'abrp')))
  const abrpCars = ((abrp?.meta ?? {}) as AbrpMeta).cars ?? {}
  // Which cars have a token is only in the encrypted credentials
  const abrpTokens = abrp ? ((await getIntegration<AbrpCredentials>(db, site.id, 'abrp', encryptionKey()))?.creds.tokens ?? {}) : {}
  const meta = (tibber?.meta ?? {}) as TibberAppMeta
  const map = meta.map ?? {}
  return rows.map((v) => ({
    id: v.id,
    vin: v.vin,
    name: v.name,
    model: v.model,
    capacityKwh: v.capacityKwh,
    tibberVehicleId: map[v.id] ?? null,
    /** null without ABRP; otherwise whether the car has a token and how the last send went (never the token) */
    abrp: abrp
      ? { linked: !!abrpTokens[v.id], lastSentAt: abrpCars[v.id]?.lastSentAt ?? null, lastError: abrpCars[v.id]?.lastError ?? null }
      : null,
    /** The departure last set from WattsWise */
    departure: meta.departures?.[v.id] ?? null,
    state: (v.state ?? {}) as Partial<VehicleState>,
    /** What ERE certificates earn per kWh charged at home (household-wide) */
    ereEurPerKwh: meta.ereEurPerKwh ?? null,
  }))
})
