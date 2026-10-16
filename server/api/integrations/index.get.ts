import { eq } from 'drizzle-orm'
import { integrations, type Provider } from '../../db/schema'
import { pulseStatus } from '../../providers/tibberPulse'

const PROVIDERS: Provider[] = ['tibber', 'solaredge', 'ecoflow_app', 'ecoflow_official']

/** Never returns secrets, only whether they are set and the non-secret settings. */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const rows = await useDb().select().from(integrations).where(eq(integrations.siteId, site.id))
  return PROVIDERS.map((provider) => {
    const r = rows.find((x) => x.provider === provider)
    return {
      provider,
      configured: !!r,
      status: r?.status ?? null,
      lastOkAt: r?.lastOkAt ?? null,
      lastError: r?.lastError ?? null,
      meta: r?.meta ?? {},
      ...(provider === 'tibber' ? { pulse: pulseStatus(site.id) } : {}),
    }
  })
})
