import { testMessage } from '../../lib/notifications'
import { notify } from '../../services/push'

/** Send a test notification to this device only. */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const { endpoint } = await readBody<{ endpoint?: string }>(event)
  if (!endpoint) throw createError({ statusCode: 400, statusMessage: 'endpoint is required' })
  const r = await notify(useDb(), site.id, null, testMessage, endpoint)
  if (!r.sent) throw createError({ statusCode: 502, statusMessage: r.error ?? 'The push service did not accept the notification' })
  return r
})
