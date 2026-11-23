import { isChargeLimitPct } from '../../../providers/zeekr'
import { assertExperimental } from '../../../services/experimental'
import { setZeekrChargeLimit } from '../../../services/zeekr'

/**
 * Set the charge limit in the car through Zeekr. Body: { pct: 50-100, steps of 5 }.
 * Returns the new targetSoc (0-1) and whether the battery level went to Tibber again with it.
 */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const id = Number(getRouterParam(event, 'id'))
  const b = await readBody<{ pct?: number }>(event)
  const pct = Number(b.pct)
  if (!isChargeLimitPct(pct)) throw createError({ statusCode: 400, statusMessage: 'Bad charge limit' })
  try {
    const { state, tibber } = await setZeekrChargeLimit(useDb(), site, encryptionKey(), id, pct)
    return { targetSoc: state.targetSoc ?? pct / 100, tibber }
  } catch (err) {
    const msg = (err as Error).message
    throw createError({ statusCode: msg === 'Car not found' ? 404 : 502, statusMessage: msg.slice(0, 200) })
  }
})
