import { solarEdgeAuthorizeUrl, type SolarEdgeCredentials } from '../../../providers/solaredge'
import { getIntegration } from '../../../services/integrations'
import { solarEdgeRedirectUri } from '../../../services/solaredge'
import { signState } from '../../../utils/crypto'

/** URL of the SolarEdge Connect consent screen. The browser goes there; SolarEdge sends it back to the callback. */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const key = encryptionKey()
  const se = await getIntegration<SolarEdgeCredentials>(useDb(), site.id, 'solaredge', key)
  if (!se) throw createError({ statusCode: 400, statusMessage: 'Save the SolarEdge client ID and secret first' })
  const redirectUri = solarEdgeRedirectUri(event)
  return { url: solarEdgeAuthorizeUrl(se.creds.clientId, redirectUri, signState({ site: site.id }, key)), redirectUri }
})
