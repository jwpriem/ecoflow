import { and, asc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { devices, plans, samples } from '../db/schema'
import type { DeviceState } from '../providers/ecoflow'
import { projectSoc } from '../lib/socForecast'
import { SLOT_MS, slotStartOf } from '../lib/time'
import { effectiveStrategy } from '../services/strategy'
import { solarForecastW } from '../services/solarForecast'

const PAST_H = 12
const FUTURE_H = 12

/** Combined and per-battery charge level: the last 12 hours (15-min averages) and a 12-hour projection from the plan. */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const db = useDb()
  const now = new Date()
  const from = new Date(slotStartOf(now).getTime() - PAST_H * 3600_000)
  const slot = slotStartOf(now)
  // The batteries are only needed to pick the samples; everything else runs alongside
  const [devs, planRows, solar] = await Promise.all([
    db.select().from(devices).where(eq(devices.siteId, site.id)).orderBy(asc(devices.id)),
    db
      .select()
      .from(plans)
      .where(and(eq(plans.siteId, site.id), gte(plans.slotStart, slot)))
      .orderBy(asc(plans.slotStart))
      .limit((FUTURE_H * 3600_000) / SLOT_MS),
    solarForecastW(db, site, slot, new Date(slot.getTime() + FUTURE_H * 3600_000)),
  ])
  const capacityWh = devs.reduce((s, d) => s + d.capacityWh, 0)

  // 15-min averages per device, worked out by Postgres so only one row per slot and battery comes back
  const bucket = sql`date_bin('15 minutes', ${samples.ts}, timestamptz '2000-01-01 00:00:00+00')`
  const rows = devs.length
    ? await db
        .select({ deviceId: samples.deviceId, slot: sql<Date>`${bucket}`.mapWith(samples.ts), soc: sql<number>`avg(${samples.soc})::float8` })
        .from(samples)
        .where(and(eq(samples.siteId, site.id), eq(samples.kind, 'battery'), gte(samples.ts, from), inArray(samples.deviceId, devs.map((d) => d.id)), isNotNull(samples.soc)))
        .groupBy(samples.deviceId, bucket)
    : []

  // Capacity-weighted for the combined level
  const buckets = new Map<number, Map<number, number>>()
  for (const r of rows) {
    if (r.deviceId == null) continue
    const k = r.slot.getTime()
    const b = buckets.get(k) ?? new Map()
    b.set(r.deviceId, r.soc)
    buckets.set(k, b)
  }
  const history = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, b]) => b.size === devs.length)
    .map(([k, b]) => {
      const per = devs.map((d) => b.get(d.id)!)
      return { ts: new Date(k + SLOT_MS / 2), soc: devs.reduce((s, d, i) => s + per[i]! * d.capacityWh, 0) / (capacityWh || 1), devices: per }
    })

  const states = devs.map((d) => d.state as DeviceState)
  const socNow = capacityWh ? devs.reduce((s, d, i) => s + (states[i]!.soc ?? 0) * d.capacityWh, 0) / capacityWh : 0
  const cfg = effectiveStrategy(site, devs)
  const forecast = projectSoc(socNow, planRows.map((p) => ({ ...p, solarW: solar.get(p.slotStart.getTime()) })), {
    capacityWh,
    maxChargeW: devs.reduce((s, d) => s + d.maxChargeW, 0),
    maxDischargeW: Math.min(cfg.maxOutputW, devs.reduce((s, d) => s + d.maxDischargeW, 0)),
    avgLoadW: cfg.avgLoadW,
    reserveSoc: cfg.reserveSoc,
    maxSoc: cfg.maxSoc,
    legEfficiency: Math.sqrt(cfg.roundTripEfficiency),
  })
  if (forecast[0]) forecast[0].ts = now

  return {
    now: now.toISOString(),
    socNow,
    reserveSoc: cfg.reserveSoc,
    maxSoc: cfg.maxSoc,
    devices: devs.map((d, i) => ({ id: d.id, name: d.name, soc: states[i]!.soc ?? null })),
    history,
    forecast,
  }
})
