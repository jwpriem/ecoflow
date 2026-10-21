import { and, eq } from 'drizzle-orm'
import { integrations, type Provider } from '../../db/schema'
import { stopEcoFlowMqtt } from '../../providers/ecoflow/mqtt'
import { stopPulse } from '../../providers/tibberPulse'
import { forgetSolarEdge } from '../../services/solaredge'

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const provider = getRouterParam(event, 'provider') as Provider
  await useDb().delete(integrations).where(and(eq(integrations.siteId, site.id), eq(integrations.provider, provider)))
  if (provider === 'tibber') stopPulse(site.id)
  if (provider === 'ecoflow_official') stopEcoFlowMqtt(site.id)
  if (provider === 'solaredge') forgetSolarEdge(site.id)
  return { ok: true }
})
