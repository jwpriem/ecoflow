import { assertExperimental } from '../../../services/experimental'
import { extendStream, nestHttpError } from '../../../services/nest'

/** Body { mediaSessionId }: keep watching for another 5 minutes */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const { mediaSessionId } = await readBody<{ mediaSessionId?: string }>(event)
  try {
    return await extendStream(useDb(), site, encryptionKey(), getRouterParam(event, 'id') ?? '', String(mediaSessionId ?? ''))
  } catch (err) {
    nestHttpError(err)
  }
})
