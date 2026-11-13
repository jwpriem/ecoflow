import { assertExperimental } from '../../../services/experimental'
import { nestHttpError, startStream } from '../../../services/nest'

/** Body { offerSdp }: the browser's WebRTC offer. Answers { answerSdp, mediaSessionId, expiresAt } from the camera. */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const { offerSdp } = await readBody<{ offerSdp?: string }>(event)
  try {
    return await startStream(useDb(), site, encryptionKey(), getRouterParam(event, 'id') ?? '', String(offerSdp ?? ''))
  } catch (err) {
    nestHttpError(err)
  }
})
