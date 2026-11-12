import { and, eq } from 'drizzle-orm'
import { lightFloors } from '../../../db/schema'
import { assertExperimental } from '../../../services/experimental'

/** Remove a floor and its plan; the lamps themselves stay */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const id = Number(getRouterParam(event, 'id'))
  await useDb().delete(lightFloors).where(and(eq(lightFloors.id, id), eq(lightFloors.siteId, site.id)))
  return { ok: true }
})
