import { assertExperimental } from '../../../services/experimental'
import { listSounds } from '../../../services/sonos'

/** The doorbell sounds the owner uploaded */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental, 'sonos')
  return listSounds(useDb(), site.id)
})
