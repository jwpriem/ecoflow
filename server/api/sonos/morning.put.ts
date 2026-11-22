import { assertExperimental } from '../../services/experimental'
import { saveMorning, sonosHttpError } from '../../services/sonos'

/** Body: { enabled?, time?, days?, playerIds?, source?, volume?, shuffle? }: music at a set time on speakers together */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireOwner(event)
  assertExperimental(experimental, 'sonos')
  const body = (await readBody(event).catch(() => null)) ?? {}
  return saveMorning(useDb(), site, encryptionKey(), body).catch(sonosHttpError)
})
