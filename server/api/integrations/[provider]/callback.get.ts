import { eq } from 'drizzle-orm'
import { appReturnUrl } from '../../../../shared/appReturn'
import { sites } from '../../../db/schema'
import {
  completeSolarEdgeAuth,
  pendingSolarEdgeSite,
  recordSolarEdgeCallback,
  solarEdgeRedirectUri,
} from '../../../services/solaredge'
import { verifyState } from '../../../utils/crypto'

/**
 * SolarEdge Connect redirects here with ?code&site_id&state. There is no bearer token on a browser
 * redirect, so the signed state says which of our sites this is for. If SolarEdge drops the state,
 * we accept the one sign-in started from Settings in the last 15 minutes.
 */
export default defineEventHandler(async (event) => {
  if (getRouterParam(event, 'provider') !== 'solaredge') throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const q = getQuery(event) as Record<string, string | undefined>
  const params = Object.keys(q).sort()
  const key = encryptionKey()
  const db = useDb()

  const fromState = q.state ? verifyState<{ site: number; app?: boolean }>(q.state, key) : null
  const stateCheck = fromState ? 'ok' : q.state ? 'invalid' : 'missing'
  const pending = fromState ? undefined : await pendingSolarEdgeSite(db)
  const siteId = fromState?.site ?? (stateCheck === 'missing' ? pending : undefined)
  const code = q.code
  const seSiteId = q.site_id ?? q.siteId ?? q.siteid

  let error: string | undefined
  if (q.error) error = String(q.error_description ?? q.error)
  else if (!siteId) error = stateCheck === 'invalid' ? 'Sign-in link expired, try again' : 'Start the sign-in from Settings and finish it within 15 minutes'
  else if (!code || !seSiteId) error = 'SolarEdge did not return a code and site ID'

  const [site] = siteId ? await db.select().from(sites).where(eq(sites.id, siteId)) : []
  if (!error && !site) error = 'Unknown site'
  if (!error) {
    try {
      error = (await completeSolarEdgeAuth(db, site!, key, code!, seSiteId!, solarEdgeRedirectUri(event))).error
    } catch (err) {
      error = (err as Error).message
    }
  }

  console.log(`[solaredge] callback params=${params.join(',')} state=${stateCheck} result=${error ?? 'ok'}`)
  const recordFor = site?.id ?? pending
  if (recordFor) await recordSolarEdgeCallback(db, recordFor, key, { params, state: stateCheck, error })
  // Started in the iOS app: the sign-in sheet closes on the app's scheme and the app shows the result
  if (fromState?.app) return sendRedirect(event, appReturnUrl('solaredge', error ?? 'ok'))
  // Back to where the sign-in started: onboarding while that's still going, otherwise Settings
  const back = site?.onboarding ? '/onboarding' : '/settings'
  return sendRedirect(event, `${back}?solaredge=${encodeURIComponent(error ?? 'ok')}`)
})
