import { assertExperimental } from '../../../services/experimental'
import { getTibberDeparture } from '../../../services/tibberEv'

/** The car's weekly departure schedule as it is in the Tibber app now. */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const id = Number(getRouterParam(event, 'id'))
  try {
    return { days: await getTibberDeparture(useDb(), site, encryptionKey(), id) }
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: (err as Error).message.slice(0, 200) })
  }
})
