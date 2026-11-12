import { asc, eq } from 'drizzle-orm'
import { lightFloors } from '../../../db/schema'
import { assertExperimental } from '../../../services/experimental'

/** The floors of the house with their plans and where the lamps are */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const rows = await useDb().select().from(lightFloors).where(eq(lightFloors.siteId, site.id)).orderBy(asc(lightFloors.sort), asc(lightFloors.id))
  return rows.map(({ id, name, sort, plan, placements }) => ({ id, name, sort, plan, placements }))
})
