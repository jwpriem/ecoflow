import { pushSubscriptions, type PushTopic } from '../../db/schema'
import { LOCALES, type Locale } from '../../lib/types'
import { PUSH_TOPICS } from '../../services/push'

/** Save (or update the topics of) this device's push subscription. */
export default defineEventHandler(async (event) => {
  const { site, user } = await requireSite(event)
  const b = await readBody<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; topics?: unknown; locale?: unknown }>(event)
  const endpoint = b.subscription?.endpoint ?? ''
  const { p256dh, auth } = b.subscription?.keys ?? {}
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw createError({ statusCode: 400, statusMessage: 'Invalid push subscription' })
  const topics = Array.isArray(b.topics) ? PUSH_TOPICS.filter((t) => (b.topics as unknown[]).includes(t)) : PUSH_TOPICS
  const locale: Locale = LOCALES.includes(b.locale as Locale) ? (b.locale as Locale) : 'nl'
  const values = { siteId: site.id, userId: user.id, endpoint, p256dh, auth, topics: topics as PushTopic[], locale, userAgent: getHeader(event, 'user-agent')?.slice(0, 200) }
  await useDb()
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { siteId: values.siteId, userId: user.id, p256dh, auth, topics: values.topics, locale, userAgent: values.userAgent } })
  return { subscribed: true, topics }
})
