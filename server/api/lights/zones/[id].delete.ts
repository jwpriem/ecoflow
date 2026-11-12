import { assertExperimental } from '../../../services/experimental'
import { deleteHueZone, hueHttpError } from '../../../services/hue'

/** Remove a group (Hue zone); its lamps stay */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  try {
    await deleteHueZone(useDb(), site, encryptionKey(), getRouterParam(event, 'id')!)
    return { ok: true }
  } catch (err) {
    hueHttpError(err)
  }
})
