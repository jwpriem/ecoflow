import { assertExperimental } from '../../../services/experimental'
import { ringDoorbell } from '../../../services/sonos'

/** Play the doorbell sound now, as a ring would, also when the doorbell link is switched off */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireOwner(event)
  assertExperimental(experimental, 'sonos')
  return ringDoorbell(useDb(), site, encryptionKey(), appBaseUrl(event), { test: true })
})
