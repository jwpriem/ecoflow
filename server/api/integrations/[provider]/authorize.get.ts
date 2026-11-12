import { hueAuthorizeUrl, type HueCredentials } from '../../../providers/hue'
import { solarEdgeAuthorizeUrl, type SolarEdgeCredentials } from '../../../providers/solaredge'
import { assertExperimental } from '../../../services/experimental'
import { hueRedirectUri } from '../../../services/hue'
import { getIntegration } from '../../../services/integrations'
import { markSolarEdgeAuthStarted, solarEdgeRedirectUri } from '../../../services/solaredge'
import { assertVerified } from '../../../services/verify'
import { signState } from '../../../utils/crypto'

/** URL of the SolarEdge Connect (or Hue) consent screen. The browser goes there; it sends the browser back to the callback. */
export default defineEventHandler(async (event) => {
  // Lives under [provider]/ because a static solaredge/ folder would shadow PUT/DELETE /api/integrations/solaredge
  const provider = getRouterParam(event, 'provider')
  if (provider !== 'solaredge' && provider !== 'hue') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const { user, site, experimental } = await requireOwner(event)
  assertVerified(user)
  const key = encryptionKey()
  const db = useDb()
  // From the iOS app (?app=1) the callback sends the result back to the app instead of to a web page
  const app = getQuery(event).app === '1'
  if (provider === 'hue') {
    assertExperimental(experimental, 'hue')
    const hue = await getIntegration<HueCredentials>(db, site.id, 'hue', key)
    if (!hue) throw createError({ statusCode: 400, statusMessage: 'Save the Hue client ID and secret first' })
    // Hue sends the browser to the callback URL registered with the app; this one has to match it
    return { url: hueAuthorizeUrl(hue.creds.clientId, signState({ site: site.id, ...(app ? { app: true } : {}) }, key)), redirectUri: hueRedirectUri(event) }
  }
  const se = await getIntegration<SolarEdgeCredentials>(db, site.id, 'solaredge', key)
  if (!se) throw createError({ statusCode: 400, statusMessage: 'Save the SolarEdge client ID and secret first' })
  await markSolarEdgeAuthStarted(db, se, key)
  const redirectUri = solarEdgeRedirectUri(event)
  return { url: solarEdgeAuthorizeUrl(se.creds.clientId, redirectUri, signState({ site: site.id, ...(app ? { app: true } : {}) }, key)), redirectUri }
})
