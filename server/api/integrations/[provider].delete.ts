import { and, eq } from 'drizzle-orm'
import { integrations, type Provider, vehicles } from '../../db/schema'
import { stopEcoFlowMqtt } from '../../providers/ecoflow/mqtt'
import { forgetTibberApp } from '../../providers/tibberApp'
import { stopPulse } from '../../providers/tibberPulse'
import { forgetSolarEdge } from '../../services/solaredge'
import { stopZeekr } from '../../services/zeekr'

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const provider = getRouterParam(event, 'provider') as Provider
  const db = useDb()
  await db.delete(integrations).where(and(eq(integrations.siteId, site.id), eq(integrations.provider, provider)))
  if (provider === 'tibber') stopPulse(site.id)
  if (provider === 'ecoflow_official') stopEcoFlowMqtt(site.id)
  if (provider === 'solaredge') forgetSolarEdge(site.id)
  if (provider === 'tibber_app') forgetTibberApp()
  if (provider === 'zeekr') {
    stopZeekr(site.id)
    await db.delete(vehicles).where(eq(vehicles.siteId, site.id))
  }
  return { ok: true }
})
