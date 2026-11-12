import { assertExperimental } from '../../../services/experimental'
import { hueHttpError, updateHueZone } from '../../../services/hue'

/** Body: { name?, lightIds? }. Rename a group or change its lamps */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const body = await readBody<{ name?: string; lightIds?: string[] }>(event)
  try {
    await updateHueZone(useDb(), site, encryptionKey(), getRouterParam(event, 'id')!, {
      ...(typeof body?.name === 'string' ? { name: body.name } : {}),
      ...(Array.isArray(body?.lightIds) ? { lightIds: body.lightIds.map(String) } : {}),
    })
    return { ok: true }
  } catch (err) {
    hueHttpError(err)
  }
})
