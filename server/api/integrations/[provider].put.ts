import type { Provider } from '../../db/schema'
import { solarEdgeOverview, type SolarEdgeCredentials } from '../../providers/solaredge'
import { tibberHomes, type TibberCredentials } from '../../providers/tibber'
import { getIntegration, markIntegration, saveIntegration } from '../../services/integrations'
import { refreshPrices } from '../../services/prices'
import { syncPulse } from '../../services/pulse'
import { runStrategy } from '../../services/strategy'

const FIELDS: Record<Provider, string[]> = {
  tibber: ['token'],
  solaredge: ['apiKey', 'siteId'],
  ecoflow_app: ['email', 'password'],
  ecoflow_official: ['accessKey', 'secretKey'],
}

/**
 * Body: { credentials?: {...}, meta?: {...} }. Credentials are encrypted before they hit the database.
 * Leave credentials out to only change settings (e.g. pick another Tibber home).
 */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const provider = getRouterParam(event, 'provider') as Provider
  if (!FIELDS[provider]) throw createError({ statusCode: 404, statusMessage: 'Unknown provider' })
  const body = await readBody<{ credentials?: Record<string, string>; meta?: Record<string, unknown> }>(event)
  const db = useDb()
  const key = encryptionKey()

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
    } else if (provider === 'solaredge') {
      const o = await solarEdgeOverview(creds as unknown as SolarEdgeCredentials)
      meta.lastTest = o
    }
  } catch (err) {
    error = (err as Error).message
  }

  await saveIntegration(db, site.id, provider, creds, meta, key)
  const saved = await getIntegration(db, site.id, provider, key)
  if (provider === 'tibber' || provider === 'solaredge') await markIntegration(db, saved!.row.id, error)

  if (provider === 'tibber' && !error) {
    await syncPulse(db, site, key)
    await refreshPrices(db, site, key).catch(() => undefined)
    await runStrategy(db, site).catch(() => undefined)
  }
  return { ok: !error, error: error ?? null, meta }
})
