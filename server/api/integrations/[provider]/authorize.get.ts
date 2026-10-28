import { solarEdgeAuthorizeUrl, type SolarEdgeCredentials } from '../../../providers/solaredge'
import { getIntegration } from '../../../services/integrations'
import { markSolarEdgeAuthStarted, solarEdgeRedirectUri } from '../../../services/solaredge'
import { signState } from '../../../utils/crypto'

/** URL of the SolarEdge Connect consent screen. The browser goes there; SolarEdge sends it back to the callback. */
export default defineEventHandler(async (event) => {
  // Lives under [provider]/ because a static solaredge/ folder would shadow PUT/DELETE /api/integrations/solaredge
  if (getRouterParam(event, 'provider') !== 'solaredge') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const { site } = await requireOwner(event)
  const key = encryptionKey()
  const db = useDb()
  const se = await getIntegration<SolarEdgeCredentials>(db, site.id, 'solaredge', key)
  if (!se) throw createError({ statusCode: 400, statusMessage: 'Save the SolarEdge client ID and secret first' })
  await markSolarEdgeAuthStarted(db, se, key)
  const redirectUri = solarEdgeRedirectUri(event)
  return { url: solarEdgeAuthorizeUrl(se.creds.clientId, redirectUri, signState({ site: site.id }, key)), redirectUri }
})
