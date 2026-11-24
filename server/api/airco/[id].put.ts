import { assertExperimental } from '../../services/experimental'
import { mideaHttpError, parseAircoChange, setAirco } from '../../services/midea'

/** Body: { running?, mode? ('auto' | 'cool' | 'dry' | 'heat' | 'fan'), targetC? (16-30, steps of 0.5), fanSpeed? (1-100, 102 = auto) } */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental, 'midea')
  const change = parseAircoChange(await readBody(event))
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^\d{1,20}$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Unknown air conditioner' })
  try {
    return { airco: await setAirco(useDb(), site, encryptionKey(), id, change) }
  } catch (err) {
    mideaHttpError(err)
  }
})
