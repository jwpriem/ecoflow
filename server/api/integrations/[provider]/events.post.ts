import { eq } from 'drizzle-orm'
import { sites } from '../../../db/schema'
import { experimentalSite } from '../../../services/experimental'
import { checkEventsToken, handleNestEvent } from '../../../services/nest'

/**
 * Google Cloud Pub/Sub pushes Nest events here (motion, person, doorbell), from the push subscription the owner
 * made on their own topic. No session: ?site and ?token (shown in Settings) say whose they are.
 * Anything but 2xx makes Pub/Sub retry, so only a wrong token is refused.
 */
export default defineEventHandler(async (event) => {
  if (getRouterParam(event, 'provider') !== 'nest') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const q = getQuery(event)
  const siteId = Number(q.site)
  const key = encryptionKey()
  if (!Number.isInteger(siteId) || !checkEventsToken(siteId, String(q.token ?? ''), key)) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  const db = useDb()
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId))
  if (!site || site.isDemo || !(await experimentalSite(db, siteId))) {
    setResponseStatus(event, 204)
    return null
  }
  const body = await readBody(event).catch(() => null)
  const r = await handleNestEvent(db, site, key, body).catch((err) => {
    console.error(`[nest] event for site ${siteId}:`, (err as Error).message)
    return { notified: null }
  })
  if (r.notified) console.log(`[nest] site ${siteId} ${r.notified}`)
  setResponseStatus(event, 204)
  return null
})
