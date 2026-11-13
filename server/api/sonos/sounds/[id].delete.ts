import { assertExperimental } from '../../../services/experimental'
import { deleteSound } from '../../../services/sonos'

export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireOwner(event)
  assertExperimental(experimental, 'sonos')
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1) throw createError({ statusCode: 400, statusMessage: 'Unknown sound' })
  await deleteSound(useDb(), site, encryptionKey(), id)
  return { ok: true }
})
