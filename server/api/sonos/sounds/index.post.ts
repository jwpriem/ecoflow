import { assertExperimental } from '../../../services/experimental'
import { addSound } from '../../../services/sonos'

/** Body: { name, data }: an MP3 or WAV of at most 1 MB, base64 */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireOwner(event)
  assertExperimental(experimental, 'sonos')
  const body = (await readBody(event).catch(() => null)) ?? {}
  return addSound(useDb(), site.id, body)
})
