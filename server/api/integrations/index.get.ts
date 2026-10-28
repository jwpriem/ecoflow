import { eq } from 'drizzle-orm'
import { integrations, type Provider } from '../../db/schema'
import { creditsLeftToday, type CreditLedger, SE_DAILY_CREDIT_CAP, SE_MONTHLY_CREDITS } from '../../lib/solaredgeBudget'
import { ecoflowMqttStatus } from '../../providers/ecoflow/mqtt'
import { pulseStatus } from '../../providers/tibberPulse'
import { visibleProviders } from '../../services/experimental'
import { solarEdgeRedirectUri } from '../../services/solaredge'

const PROVIDERS: Provider[] = ['tibber', 'solaredge', 'ecoflow_official', 'zeekr', 'tibber_app']

/** Never returns secrets, only whether they are set and the non-secret settings. Experimental providers only for an experimental household. */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  const rows = await useDb().select().from(integrations).where(eq(integrations.siteId, site.id))
  return visibleProviders(PROVIDERS, experimental).map((provider) => {
    const r = rows.find((x) => x.provider === provider)
    return {
      provider,
      configured: !!r,
      status: r?.status ?? null,
      lastOkAt: r?.lastOkAt ?? null,
      lastError: r?.lastError ?? null,
      meta: r?.meta ?? {},
      ...(provider === 'tibber' ? { pulse: pulseStatus(site.id) } : {}),
      ...(provider === 'ecoflow_official' ? { mqtt: ecoflowMqttStatus(site.id) } : {}),
      ...(provider === 'solaredge'
        ? {
            redirectUri: solarEdgeRedirectUri(event),
            credits: {
              today: SE_DAILY_CREDIT_CAP - creditsLeftToday(r?.meta.credits as CreditLedger | undefined, new Date(), site.timezone),
              dailyCap: SE_DAILY_CREDIT_CAP,
              monthly: SE_MONTHLY_CREDITS,
            },
          }
        : {}),
    }
  })
})
