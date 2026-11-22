import { assertExperimental } from '../../../services/experimental'
import { startMorning } from '../../../services/sonos'

/** Start the morning music now, as the alarm would, also when it is switched off */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireOwner(event)
  assertExperimental(experimental, 'sonos')
  rateLimit([LIMITS.testSendSite, String(site.id)])
  return startMorning(useDb(), site, encryptionKey(), { test: true })
})
