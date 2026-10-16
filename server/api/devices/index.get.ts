import { asc, eq } from 'drizzle-orm'
import { devices } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  return useDb().select().from(devices).where(eq(devices.siteId, site.id)).orderBy(asc(devices.id))
})
