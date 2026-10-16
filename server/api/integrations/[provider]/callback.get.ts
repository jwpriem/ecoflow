import { eq } from 'drizzle-orm'
import { sites } from '../../../db/schema'
import { completeSolarEdgeAuth, solarEdgeRedirectUri } from '../../../services/solaredge'
import { verifyState } from '../../../utils/crypto'

/**
 * SolarEdge Connect redirects here with ?code&site_id&state. There is no bearer token on a browser
 * redirect, so the signed state says which of our sites this is for.
 */
export default defineEventHandler(async (event) => {
  if (getRouterParam(event, 'provider') !== 'solaredge') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const q = getQuery(event) as Record<string, string | undefined>
  const back = (result: string) => sendRedirect(event, `/settings?solaredge=${encodeURIComponent(result)}`)
  if (q.error) return back(String(q.error_description ?? q.error))

  const key = encryptionKey()
  const state = q.state ? verifyState<{ site: number }>(q.state, key) : null
  if (!state) return back('Sign-in link expired, try again')
  if (!q.code || !q.site_id) return back('SolarEdge did not return a code and site ID')

  const db = useDb()
  const [site] = await db.select().from(sites).where(eq(sites.id, state.site))
  if (!site) return back('Unknown site')
  try {
    const { error } = await completeSolarEdgeAuth(db, site, key, q.code, q.site_id, solarEdgeRedirectUri(event))
    return back(error ?? 'ok')
  } catch (err) {
    return back((err as Error).message)
  }
})
