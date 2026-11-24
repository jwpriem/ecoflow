import { assertExperimental } from '../../services/experimental'
import { aircoHistory } from '../../services/midea'

/** The temperatures of the last ?hours= (1-168, default 24), per air conditioner */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental, 'midea')
  const h = Number(getQuery(event).hours ?? 24)
  const hours = Number.isFinite(h) ? Math.min(168, Math.max(1, Math.round(h))) : 24
  return { hours, aircos: await aircoHistory(useDb(), site.id, hours) }
})
