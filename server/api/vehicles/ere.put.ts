import { assertExperimental } from '../../services/experimental'
import { setEreValue } from '../../services/tibberEv'

/** What ERE certificates earn per kWh through the charger. Body: { eurPerKwh: number | null } (0-1). */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const b = await readBody<{ eurPerKwh?: number | null }>(event)
  const v = b.eurPerKwh == null ? null : Number(b.eurPerKwh)
  if (v != null && (!Number.isFinite(v) || v < 0 || v > 1)) throw createError({ statusCode: 400, statusMessage: 'Bad eurPerKwh' })
  try {
    await setEreValue(useDb(), site, encryptionKey(), v)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message.slice(0, 200) })
  }
  return { eurPerKwh: v && v > 0 ? v : null }
})
