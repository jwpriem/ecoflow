import type { HueChange } from '../../../lib/hue'
import { assertExperimental } from '../../../services/experimental'
import { hueHttpError, setHueLight } from '../../../services/hue'

/** Body: { on?, brightness? (0-100), mirek? (153-500) | xy? } for one lamp */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const body = await readBody<HueChange>(event)
  try {
    await setHueLight(useDb(), site, encryptionKey(), getRouterParam(event, 'id')!, body ?? {})
    return { ok: true }
  } catch (err) {
    hueHttpError(err)
  }
})
