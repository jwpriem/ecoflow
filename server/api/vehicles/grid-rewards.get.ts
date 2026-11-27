import { assertExperimental } from '../../services/experimental'
import { getTibberGridRewards } from '../../services/tibberEv'

/** Tibber Grid Rewards for the home; `rewards` is null when the Tibber app isn't connected or the home has none. */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  try {
    return { rewards: await getTibberGridRewards(useDb(), site, encryptionKey()) }
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: (err as Error).message.slice(0, 200) })
  }
})
