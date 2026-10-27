import { and, asc, desc, eq, gte } from 'drizzle-orm'
import { batteryPool, devices, integrations, plans, samples } from '../db/schema'
import type { DeviceState } from '../providers/ecoflow'
import { slotStartOf, startOfLocalDay } from '../lib/time'
import { liveState } from '../services/collector'
import { getPrices } from '../services/prices'
import { savingsByPeriod } from '../services/ledger'
import { solarByPeriod } from '../services/solar'
import { pulseStatus } from '../providers/tibberPulse'

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const db = useDb()
  const now = new Date()
  const slot = slotStartOf(now)
  const dayStart = startOfLocalDay(now, site.timezone)
  const latest = (kind: 'grid' | 'solar') =>
    db.select().from(samples).where(and(eq(samples.siteId, site.id), eq(samples.kind, kind))).orderBy(desc(samples.ts)).limit(1).then((r) => r[0])
  const cached = liveState(site.id)

  // None of these depend on each other: run them together, so Home waits for one round trip instead of ten
  const [devs, pools, [price], next, [today], [solarToday], ints, grid, solar] = await Promise.all([
    db.select().from(devices).where(eq(devices.siteId, site.id)).orderBy(asc(devices.id)),
    db
      .select({ pool: batteryPool })
      .from(batteryPool)
      .innerJoin(devices, eq(devices.id, batteryPool.deviceId))
      .where(eq(devices.siteId, site.id))
      .then((r) => r.map((p) => p.pool)),
    getPrices(db, site.id, slot, new Date(slot.getTime() + 15 * 60_000)),
    db.select().from(plans).where(and(eq(plans.siteId, site.id), gte(plans.slotStart, slot))).orderBy(asc(plans.slotStart)).limit(16),
    savingsByPeriod(db, site, 'day', dayStart, now),
    solarByPeriod(db, site, 'day', dayStart, now),
    db.select({ provider: integrations.provider, status: integrations.status }).from(integrations).where(eq(integrations.siteId, site.id)),
    // The last stored readings, only when the collector has no live state in memory (just after a restart)
    cached ? undefined : latest('grid'),
    cached ? undefined : latest('solar'),
  ])

  let live = cached
  if (!live && grid) {
    live = { ts: grid.ts.toISOString(), gridW: grid.powerW, houseNetW: grid.powerW - devs.reduce((t, d) => t + ((d.state as DeviceState).powerW ?? 0), 0), solarW: solar?.powerW ?? null, houseSource: 'pulse', solarSource: solar ? 'solaredge' : null }
  }

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
        // What the energy now in this battery cost to put there (weighted average, losses included)
        stored: pool ? { kwh: pool.kwh, costNaive: pool.costNaive, costOpportunity: pool.costOpportunity } : null,
      }
    }),
    live: live ?? null,
    price: price ?? null,
    next: next.map((p) => ({ slotStart: p.slotStart, action: p.action, price: p.price, reason: p.reason, targetW: p.targetW })),
    today: today ?? null,
    solarToday: solarToday ?? null,
    sources: {
      pulse: pulseStatus(site.id),
      integrations: ints,
    },
  }
})
