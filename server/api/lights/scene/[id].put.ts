import { assertExperimental } from '../../../services/experimental'
import { hueHttpError, recallHueScene } from '../../../services/hue'

/** Set a scene from the Hue app on its room or zone */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  try {
    await recallHueScene(useDb(), site, encryptionKey(), getRouterParam(event, 'id')!)
    return { ok: true }
  } catch (err) {
    hueHttpError(err)
  }
})
