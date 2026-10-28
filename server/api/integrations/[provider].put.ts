import { eq } from 'drizzle-orm'
import { type Provider, vehicles } from '../../db/schema'
import { tibberHomes, type TibberCredentials } from '../../providers/tibber'
import { forgetTibberApp } from '../../providers/tibberApp'
import { getIntegration, markIntegration, saveIntegration } from '../../services/integrations'
import { assertExperimental } from '../../services/experimental'
import { refreshPrices } from '../../services/prices'
import { syncEcoFlowDevices } from '../../services/ecoflow'
import { syncPulse } from '../../services/pulse'
import { forgetSolarEdge, testSolarEdge } from '../../services/solaredge'
import { runStrategy } from '../../services/strategy'
import { syncTibberApp } from '../../services/tibberEv'
import { readZeekrVehicles, syncZeekrVehicles } from '../../services/zeekr'

const FIELDS: Record<Provider, string[]> = {
  tibber: ['token'],
  solaredge: ['clientId', 'clientSecret'],
  ecoflow_official: ['accessKey', 'secretKey'],
  zeekr: ['username', 'password', 'hmacAccessKey', 'hmacSecretKey', 'passwordPublicKey', 'prodSecret', 'vinKey', 'vinIv'],
  tibber_app: ['email', 'password'],
}

/**
 * Body: { credentials?: {...}, meta?: {...} }. Credentials are encrypted before they hit the database.
 * Leave credentials out to only change settings (e.g. pick another Tibber home).
 */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireOwner(event)
  const provider = getRouterParam(event, 'provider') as Provider
  if (!FIELDS[provider]) throw createError({ statusCode: 404, statusMessage: 'Unknown provider' })
  assertExperimental(experimental, provider)
  const body = await readBody<{ credentials?: Record<string, string>; meta?: Record<string, unknown> }>(event)
  const db = useDb()
  const key = encryptionKey()

  // Nothing to save: test the stored sign-in instead of re-saving, which would reset the status
  if (provider === 'solaredge' && !body.credentials) {
    const { error, meta } = await testSolarEdge(db, site, key)
    return { ok: !error, error: error ?? null, meta }
  }

  const existing = await getIntegration<Record<string, string>>(db, site.id, provider, key)
  let creds = existing?.creds
  if (body.credentials) {
    creds = {}
    for (const f of FIELDS[provider]) {
      const v = String(body.credentials[f] ?? '').trim()
      if (!v) throw createError({ statusCode: 400, statusMessage: `${f} is required` })
      creds[f] = v
    }
  }
  if (!creds) throw createError({ statusCode: 400, statusMessage: 'Credentials are required' })
  const meta: Record<string, unknown> = { ...(existing?.meta ?? {}), ...(body.meta ?? {}) }

  // Test the connection and fill in useful settings before saving
  let error: string | undefined
  try {
    if (provider === 'tibber') {
      const homes = await tibberHomes(creds as unknown as TibberCredentials)
      if (!homes.length) throw new Error('No homes on this Tibber account')
      const home = homes.find((h) => h.id === meta.homeId) ?? homes[0]!
      meta.homeId = home.id
      meta.realtime = home.features?.realTimeConsumptionEnabled ?? false
      meta.homes = homes.map((h) => ({ id: h.id, name: h.appNickname || h.address?.address1 || h.id }))
    } else if (provider === 'solaredge' && body.credentials) {
      // New client credentials have no tokens yet: the owner signs in next (GET .../solaredge/authorize)
      meta.authorized = false
    }
  } catch (err) {
    error = (err as Error).message
  }

  await saveIntegration(db, site.id, provider, creds, meta, key)
  const saved = await getIntegration(db, site.id, provider, key)
  if (provider === 'tibber') await markIntegration(db, saved!.row.id, error)
  if (provider === 'solaredge') forgetSolarEdge(site.id)

  // Lists the units on the EcoFlow account, adds them as batteries and records the outcome
  if (provider === 'ecoflow_official') {
    const r = await syncEcoFlowDevices(db, site, key)
    const synced = await getIntegration(db, site.id, provider, key)
    return { ok: !r.error, error: r.error ?? null, meta: synced?.meta ?? meta }
  }

  // Signs in to Zeekr, adds every car on the account (incl. shared cars) and records the outcome
  if (provider === 'zeekr') {
    const r = await syncZeekrVehicles(db, site, key)
    // Read the cars straight away so the Cars tab fills without waiting for the 5-minute job
    if (!r.error) await readZeekrVehicles(db, site, key).catch(() => undefined)
    const synced = await getIntegration(db, site.id, provider, key)
    return { ok: !r.error, error: r.error ?? null, meta: synced?.meta ?? meta }
  }

  // Signs in to the Tibber app, finds the home, cars and charger, and matches our cars to Tibber's
  if (provider === 'tibber_app') {
    forgetTibberApp()
    const cars = await db.select().from(vehicles).where(eq(vehicles.siteId, site.id))
    const r = await syncTibberApp(db, site, key, cars)
    const synced = await getIntegration(db, site.id, provider, key)
    return { ok: !r.error, error: r.error ?? null, meta: synced?.meta ?? meta }
  }

  if (provider === 'tibber' && !error) {
    await syncPulse(db, site, key)
    await refreshPrices(db, site, key).catch(() => undefined)
    await runStrategy(db, site).catch(() => undefined)
  }
  return { ok: !error, error: error ?? null, meta }
})
