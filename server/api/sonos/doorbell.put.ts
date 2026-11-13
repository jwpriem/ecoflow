import { assertExperimental } from '../../services/experimental'
import { saveDoorbell } from '../../services/sonos'

/** Body: { enabled?, playerId?, volume?, sound? }: which speaker plays the doorbell, how loud and which sound */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireOwner(event)
  assertExperimental(experimental, 'sonos')
  const body = (await readBody(event).catch(() => null)) ?? {}
  return saveDoorbell(useDb(), site, encryptionKey(), body)
})
