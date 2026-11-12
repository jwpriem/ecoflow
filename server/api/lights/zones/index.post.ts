import { assertExperimental } from '../../../services/experimental'
import { createHueZone, hueHttpError } from '../../../services/hue'

/** Body: { name, lightIds }. A new group of lamps, made as a Hue zone */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const body = await readBody<{ name?: string; lightIds?: string[] }>(event)
  try {
    return await createHueZone(useDb(), site, encryptionKey(), String(body?.name ?? ''), Array.isArray(body?.lightIds) ? body.lightIds.map(String) : [])
  } catch (err) {
    hueHttpError(err)
  }
})
