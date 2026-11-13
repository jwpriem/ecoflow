import { assertExperimental } from '../../../services/experimental'
import { nestHttpError, stopStream } from '../../../services/nest'

/** Body { mediaSessionId }: done watching */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const { mediaSessionId } = await readBody<{ mediaSessionId?: string }>(event)
  try {
    await stopStream(useDb(), site, encryptionKey(), getRouterParam(event, 'id') ?? '', String(mediaSessionId ?? ''))
    return { ok: true }
  } catch (err) {
    nestHttpError(err)
  }
})
