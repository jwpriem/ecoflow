import { assertExperimental } from '../../services/experimental'
import { listMusic, sonosHttpError } from '../../services/sonos'

/** The Sonos favorites and Sonos playlists the morning music can play, per household */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireOwner(event)
  assertExperimental(experimental, 'sonos')
  return listMusic(useDb(), site, encryptionKey()).catch(sonosHttpError)
})
