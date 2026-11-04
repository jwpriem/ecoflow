import { and, eq } from 'drizzle-orm'
import { vehicles } from '../../../db/schema'
import { assertExperimental } from '../../../services/experimental'
import { getTibberChargingPlan } from '../../../services/tibberEv'

/** The car's smart-charging plan as Tibber has it now; `plan` is null when the car isn't linked to Tibber. */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const id = Number(getRouterParam(event, 'id'))
  const db = useDb()
  const [car] = await db.select().from(vehicles).where(and(eq(vehicles.id, id), eq(vehicles.siteId, site.id)))
  if (!car) throw createError({ statusCode: 404, statusMessage: 'No such car' })
  try {
    return { plan: await getTibberChargingPlan(db, site, encryptionKey(), car) }
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: (err as Error).message.slice(0, 200) })
  }
})
