import { and, eq } from 'drizzle-orm'
import { pushSubscriptions } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const endpoint = String(getQuery(event).endpoint ?? '')
  await useDb().delete(pushSubscriptions).where(and(eq(pushSubscriptions.siteId, site.id), eq(pushSubscriptions.endpoint, endpoint)))
  return { subscribed: false }
})
