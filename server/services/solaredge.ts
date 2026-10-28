import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { Db } from '../db/client'
import { integrations, type sites } from '../db/schema'
import {
  addCredits,
  creditsLeftToday,
  type CreditLedger,
  SE_POLL_MS,
  seInWindow,
  seInstant,
  sePollSlot,
  seTokenNeedsRefresh,
} from '../lib/solaredgeBudget'
import {
  type SolarEdgeCredentials,
  SolarEdgeError,
  solarEdgeExchangeCode,
  solarEdgePower,
  solarEdgeRefresh,
  solarEdgeSite,
} from '../providers/solaredge'
import { seReadFrom } from '../lib/solar'
import { getIntegration, markIntegration, updateIntegration } from './integrations'
import { latestSolarSlot, storeSolarProduction } from './solar'

type Site = typeof sites.$inferSelect
type Integration = NonNullable<Awaited<ReturnType<typeof getIntegration<SolarEdgeCredentials>>>>

const CALLBACK_PATH = '/api/integrations/solaredge/callback'

/** Must be registered as the redirect URI of the Site Access app in the SolarEdge developer console */
export function solarEdgeRedirectUri(event: H3Event): string {
  return `${appBaseUrl(event)}${CALLBACK_PATH}`
}

/** Count one call against the credit ledger; failed calls count too, to stay on the safe side */
async function spend(db: Db, se: Integration, site: Site, key: string, now: Date) {
  const credits = addCredits(se.meta.credits as CreditLedger | undefined, now, site.timezone)
  se.meta = { ...se.meta, credits }
  await updateIntegration(db, se.row.id, { meta: se.meta }, key)
}

async function saveTokens(db: Db, se: Integration, creds: SolarEdgeCredentials, key: string) {
  se.creds = creds
  await updateIntegration(db, se.row.id, { creds }, key)
}

/** Drop the tokens so we stop spending credits until the owner signs in again */
async function revoke(db: Db, se: Integration, key: string, message: string) {
  const { clientId, clientSecret } = se.creds
  se.creds = { clientId, clientSecret }
  se.meta = { ...se.meta, authorized: false }
  await updateIntegration(db, se.row.id, { creds: se.creds, meta: se.meta }, key)
  await markIntegration(db, se.row.id, message)
}

const refreshing = new Map<number, Promise<string>>()

/** A valid access token, refreshed (one credit) when it is about to expire */
async function accessToken(db: Db, se: Integration, site: Site, key: string, now: Date): Promise<string> {
  if (!seTokenNeedsRefresh(se.creds.expiresAt, now)) return se.creds.accessToken!
  const pending = refreshing.get(se.row.id)
  if (pending) return pending
  const run = (async () => {
    await spend(db, se, site, key, now)
    try {
      const tokens = await solarEdgeRefresh(se.creds)
      await saveTokens(db, se, { ...se.creds, ...tokens }, key)
      return tokens.accessToken
    } catch (err) {
      if (err instanceof SolarEdgeError && err.kind === 'auth') {
        await revoke(db, se, key, 'SolarEdge access expired or was revoked. Sign in with SolarEdge again.')
        forgetSolarEdge(site.id)
      }
      throw err
    }
  })().finally(() => refreshing.delete(se.row.id))
  refreshing.set(se.row.id, run)
  return run
}

/** OAuth callback: swap the code for tokens and check the site with one read (two credits) */
export async function completeSolarEdgeAuth(db: Db, site: Site, key: string, code: string, seSiteId: string, redirectUri: string) {
  const se = await getIntegration<SolarEdgeCredentials>(db, site.id, 'solaredge', key)
  if (!se) throw new Error('Save the SolarEdge client ID and secret first')
  const now = new Date()
  await spend(db, se, site, key, now)
  const tokens = await solarEdgeExchangeCode(se.creds, code, redirectUri)
  await saveTokens(db, se, { clientId: se.creds.clientId, clientSecret: se.creds.clientSecret, ...tokens }, key)
  se.meta = { ...se.meta, siteId: seSiteId, authorized: true }
  let error: string | undefined
  try {
    await spend(db, se, site, key, now)
    se.meta.lastTest = await solarEdgeSite(tokens.accessToken, seSiteId)
  } catch (err) {
    error = (err as Error).message
  }
  await updateIntegration(db, se.row.id, { meta: se.meta }, key)
  await markIntegration(db, se.row.id, error)
  forgetSolarEdge(site.id)
  return { error }
}

/**
 * "Save & test" without new credentials: check the stored sign-in with one read of the site
 * (one credit, two when the access token needs a refresh) and record the result.
 */
export async function testSolarEdge(db: Db, site: Site, key: string) {
  const se = await getIntegration<SolarEdgeCredentials>(db, site.id, 'solaredge', key)
  if (!se) return { error: 'Save the SolarEdge client ID and secret first', meta: {} }
  const seSiteId = se.meta.siteId as string | undefined
  if (!se.creds.refreshToken || !seSiteId) return { error: 'Sign in with SolarEdge first', meta: se.meta }
  const now = new Date()
  const needed = seTokenNeedsRefresh(se.creds.expiresAt, now) ? 2 : 1
  if (creditsLeftToday(se.meta.credits as CreditLedger | undefined, now, site.timezone) < needed) {
    return { error: 'Daily SolarEdge credit budget used up, try again tomorrow', meta: se.meta }
  }
  let error: string | undefined
  try {
    const token = await accessToken(db, se, site, key, now)
    await spend(db, se, site, key, now)
    se.meta = { ...se.meta, lastTest: await solarEdgeSite(token, seSiteId) }
    await updateIntegration(db, se.row.id, { meta: se.meta }, key)
  } catch (err) {
    error = (err as Error).message
    // Token rejected before its expiry: refresh on the next call
    if (err instanceof SolarEdgeError && err.kind === 'auth' && se.creds.refreshToken) {
      await saveTokens(db, se, { ...se.creds, expiresAt: 0 }, key)
    }
  }
  // accessToken() already marked the row and dropped the tokens when the refresh token was rejected
  if (se.creds.refreshToken) await markIntegration(db, se.row.id, error)
  return { error, meta: se.meta }
}

const PENDING_AUTH_MS = 15 * 60_000

/** Remember that this site started a sign-in, for a callback that comes back without `state` */
export async function markSolarEdgeAuthStarted(db: Db, se: Integration, key: string) {
  se.meta = { ...se.meta, pendingAuthUntil: Date.now() + PENDING_AUTH_MS }
  await updateIntegration(db, se.row.id, { meta: se.meta }, key)
}

/** The one site with a sign-in started in the last 15 minutes, if there is exactly one */
export async function pendingSolarEdgeSite(db: Db): Promise<number | undefined> {
  const rows = await db
    .select({ siteId: integrations.siteId, meta: integrations.meta })
    .from(integrations)
    .where(eq(integrations.provider, 'solaredge'))
  const pending = rows.filter((r) => Number(r.meta.pendingAuthUntil ?? 0) > Date.now())
  return pending.length === 1 ? pending[0]!.siteId : undefined
}

/**
 * Keep what the last callback looked like (parameter names only, never values) and its outcome,
 * so a failed sign-in shows up in Settings instead of only in the browser that was redirected.
 */
export async function recordSolarEdgeCallback(
  db: Db,
  siteId: number,
  key: string,
  info: { params: string[]; state: 'ok' | 'invalid' | 'missing'; error?: string },
) {
  const se = await getIntegration<SolarEdgeCredentials>(db, siteId, 'solaredge', key)
  if (!se) return
  const { pendingAuthUntil: _done, ...meta } = se.meta
  const lastCallback = { at: new Date().toISOString(), params: info.params, state: info.state, result: info.error ?? 'ok' }
  await updateIntegration(db, se.row.id, { meta: { ...meta, lastCallback } }, key)
  if (info.error) await markIntegration(db, se.row.id, `SolarEdge sign-in: ${info.error}`)
}

interface PollState {
  active: boolean
  slot: number
  solarW?: number
  at?: number
  pausedUntil?: number
}
const polls = new Map<number, PollState>()

/** Call after the SolarEdge integration of a site changes */
export function forgetSolarEdge(siteId: number) {
  polls.delete(siteId)
}

/**
 * Solar production in W for the collector, which calls this every minute. SolarEdge is read at most
 * once per 20-minute slot between 05:00 and 22:00 site time (51 reads + ~9 token refreshes a day,
 * about 1,860 credits in 31 days). Outside that window it is dark, so we return 0 without a call.
 * Each read also stores every quarter-hour bucket since the last one we have, for the solar ledger.
 */
export async function solarEdgeSolarW(db: Db, site: Site, key: string, now = new Date()): Promise<number | undefined> {
  let st = polls.get(site.id)
  if (!st) {
    const se = await getIntegration<SolarEdgeCredentials>(db, site.id, 'solaredge', key)
    st = { active: !!(se?.creds.refreshToken && se.meta.siteId), slot: -1 }
    polls.set(site.id, st)
  }
  if (!st.active) return undefined
  if (!seInWindow(now, site.timezone)) return 0

  const slot = sePollSlot(now)
  const paused = st.pausedUntil !== undefined && now.getTime() < st.pausedUntil
  if (slot !== st.slot && !paused) {
    st.slot = slot
    const w = await poll(db, site, key, st, now)
    if (w !== undefined) {
      st.solarW = w
      st.at = now.getTime()
    }
  }
  // Keep the last reading for two slots; after that we would rather show nothing than stale data
  return st.at !== undefined && now.getTime() - st.at < 2 * SE_POLL_MS ? st.solarW : undefined
}

async function poll(db: Db, site: Site, key: string, st: PollState, now: Date): Promise<number | undefined> {
  const se = await getIntegration<SolarEdgeCredentials>(db, site.id, 'solaredge', key)
  const seSiteId = se?.meta.siteId as string | undefined
  if (!se || !se.creds.refreshToken || !seSiteId) {
    st.active = false
    return undefined
  }
  const needed = seTokenNeedsRefresh(se.creds.expiresAt, now) ? 2 : 1
  if (creditsLeftToday(se.meta.credits as CreditLedger | undefined, now, site.timezone) < needed) {
    await markIntegration(db, se.row.id, 'Daily SolarEdge credit budget used up, resuming tomorrow')
    return undefined
  }
  try {
    const token = await accessToken(db, se, site, key, now)
    await spend(db, se, site, key, now)
    const from = seReadFrom(now, await latestSolarSlot(db, site.id))
    const buckets = await solarEdgePower(token, seSiteId, seInstant(from), seInstant(now))
    await storeSolarProduction(db, site, buckets)
    await markIntegration(db, se.row.id)
    return buckets.at(-1)?.w
  } catch (err) {
    if (err instanceof SolarEdgeError) {
      // Token rejected before its expiry: refresh on the next slot
      if (err.kind === 'auth' && se.creds.refreshToken) await saveTokens(db, se, { ...se.creds, expiresAt: 0 }, key)
      // Monthly credits gone (or our ledger is off): stop asking for six hours
      if (err.kind === 'credits') st.pausedUntil = now.getTime() + 6 * 3_600_000
    }
    if (polls.get(site.id) === st) await markIntegration(db, se.row.id, (err as Error).message)
    return undefined
  }
}
