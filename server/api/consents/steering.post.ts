import { STEERING_VERSION } from '../../lib/legal'
import { recordConsent } from '../../services/consent'

/** Body: { version }. Accepts the steering disclaimer; only the version the app showed, and only the current one. */
export default defineEventHandler(async (event) => {
  const { user } = await requireSite(event)
  const { version } = await readBody<{ version?: string }>(event)
  if (version !== STEERING_VERSION) throw createError({ statusCode: 409, statusMessage: 'The steering terms changed: read them again', data: { version: STEERING_VERSION } })
  await recordConsent(useDb(), user.id, 'steering', STEERING_VERSION)
  return { version: STEERING_VERSION }
})
