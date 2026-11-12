import type { HueChange } from '../../../lib/hue'
import { assertExperimental } from '../../../services/experimental'
import { hueHttpError, setHueGroup } from '../../../services/hue'

/** As for one lamp, for a whole room or zone; :id is its grouped_light */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const body = await readBody<HueChange>(event)
  try {
    await setHueGroup(useDb(), site, encryptionKey(), getRouterParam(event, 'id')!, body ?? {})
    return { ok: true }
  } catch (err) {
    hueHttpError(err)
  }
})
