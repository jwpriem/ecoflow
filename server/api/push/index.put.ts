import { pushSubscriptions, type PushTopic } from '../../db/schema'
import { PUSH_TOPICS } from '../../services/push'

/** Save (or update the topics of) this device's push subscription. */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const b = await readBody<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; topics?: unknown }>(event)
  const endpoint = b.subscription?.endpoint ?? ''
  const { p256dh, auth } = b.subscription?.keys ?? {}
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw createError({ statusCode: 400, statusMessage: 'Invalid push subscription' })
  const topics = Array.isArray(b.topics) ? PUSH_TOPICS.filter((t) => (b.topics as unknown[]).includes(t)) : PUSH_TOPICS
  const values = { siteId: site.id, endpoint, p256dh, auth, topics: topics as PushTopic[], userAgent: getHeader(event, 'user-agent')?.slice(0, 200) }
  await useDb()
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { siteId: values.siteId, p256dh, auth, topics: values.topics, userAgent: values.userAgent } })
  return { subscribed: true, topics }
})
