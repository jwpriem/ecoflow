import { assertExperimental } from '../../services/experimental'
import { mideaHttpError, readAircos } from '../../services/midea'

/** The air conditioners on the household's Midea account and how each one is set. ?fresh=1 skips the 30 s cache. */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental, 'midea')
  try {
    return { aircos: await readAircos(useDb(), site, encryptionKey(), { fresh: getQuery(event).fresh === '1' }) }
  } catch (err) {
    mideaHttpError(err)
  }
})
