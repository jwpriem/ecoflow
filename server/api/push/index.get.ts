import { and, eq } from 'drizzle-orm'
import { pushSubscriptions } from '../../db/schema'
import { vapidKeys } from '../../services/push'

/** The public VAPID key to subscribe with, and the topics of this device's subscription (if any). */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const endpoint = String(getQuery(event).endpoint ?? '')
  const db = useDb()
  const { publicKey } = await vapidKeys(db)
  const [sub] = endpoint
    ? await db.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.siteId, site.id), eq(pushSubscriptions.endpoint, endpoint)))
    : []
  return { publicKey, subscribed: !!sub, topics: sub?.topics ?? null }
})
