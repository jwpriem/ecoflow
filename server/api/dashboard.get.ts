import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { batteryPool, devices, integrations, plans, samples } from '../db/schema'
import type { DeviceState } from '../providers/ecoflow'
import { slotStartOf, startOfLocalDay } from '../lib/time'
import { liveState } from '../services/collector'
import { getPrices } from '../services/prices'
import { savingsByPeriod } from '../services/ledger'
import { pulseStatus } from '../providers/tibberPulse'

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const db = useDb()
  const now = new Date()
  const devs = await db.select().from(devices).where(eq(devices.siteId, site.id)).orderBy(asc(devices.id))
  const pools = devs.length ? await db.select().from(batteryPool).where(inArray(batteryPool.deviceId, devs.map((d) => d.id))) : []

  let live = liveState(site.id)
  if (!live) {
    const [grid] = await db.select().from(samples).where(and(eq(samples.siteId, site.id), eq(samples.kind, 'grid'))).orderBy(desc(samples.ts)).limit(1)
    const [solar] = await db.select().from(samples).where(and(eq(samples.siteId, site.id), eq(samples.kind, 'solar'))).orderBy(desc(samples.ts)).limit(1)
    if (grid) live = { ts: grid.ts.toISOString(), gridW: grid.powerW, houseNetW: grid.powerW - devs.reduce((t, d) => t + ((d.state as DeviceState).powerW ?? 0), 0), solarW: solar?.powerW ?? null, houseSource: 'pulse', solarSource: solar ? 'solaredge' : null }
  }

  const slot = slotStartOf(now)
  const [price] = await getPrices(db, site.id, slot, new Date(slot.getTime() + 15 * 60_000))
  const next = await db.select().from(plans).where(and(eq(plans.siteId, site.id), gte(plans.slotStart, slot))).orderBy(asc(plans.slotStart)).limit(16)

  const dayStart = startOfLocalDay(now, site.timezone)
  const [today] = await savingsByPeriod(db, site, 'day', dayStart, now)

  const ints = await db.select({ provider: integrations.provider, status: integrations.status }).from(integrations).where(eq(integrations.siteId, site.id))

  return {
    now: now.toISOString(),
    site: { name: site.name, controlMode: site.controlMode, override: site.override },
    devices: devs.map((d) => {
      const s = d.state as DeviceState
      const pool = pools.find((p) => p.deviceId === d.id)
      return {
        id: d.id,
        name: d.name,
        model: d.model,
        driver: d.driver,
        capacityWh: d.capacityWh,
        soc: s.soc ?? null,
        powerW: s.powerW ?? 0,
        pvW: s.pvW ?? 0,
        mode: s.mode ?? null,
        updatedAt: s.ts ?? null,
        avgCostOpportunity: pool && pool.kwh > 0 ? pool.costOpportunity / pool.kwh : null,
        avgCostNaive: pool && pool.kwh > 0 ? pool.costNaive / pool.kwh : null,
      }
    }),
    live: live ?? null,
    price: price ?? null,
    next: next.map((p) => ({ slotStart: p.slotStart, action: p.action, price: p.price, reason: p.reason, targetW: p.targetW })),
    today: today ?? null,
    sources: {
      pulse: pulseStatus(site.id),
      integrations: ints,
    },
  }
})
