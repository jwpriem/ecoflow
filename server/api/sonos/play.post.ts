import { assertExperimental } from '../../services/experimental'
import { playNow } from '../../services/sonos'

/** Body: { source: { kind, id }, volume }: music now from Home, on the morning music's speakers, without saving anything */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireOwner(event)
  assertExperimental(experimental, 'sonos')
  rateLimit([LIMITS.testSendSite, String(site.id)])
  const body = (await readBody(event).catch(() => null)) ?? {}
  return playNow(useDb(), site, encryptionKey(), body)
})
