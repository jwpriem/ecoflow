import { and, asc, eq, gte, inArray } from 'drizzle-orm'
import { devices, plans, samples } from '../db/schema'
import type { DeviceState } from '../providers/ecoflow'
import { projectSoc } from '../lib/socForecast'
import { SLOT_MS, slotStartOf } from '../lib/time'

const PAST_H = 12
const FUTURE_H = 12

/** Combined and per-battery charge level: the last 12 hours (15-min averages) and a 12-hour projection from the plan. */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const db = useDb()
  const now = new Date()
  const from = new Date(slotStartOf(now).getTime() - PAST_H * 3600_000)
  const devs = await db.select().from(devices).where(eq(devices.siteId, site.id)).orderBy(asc(devices.id))
  const capacityWh = devs.reduce((s, d) => s + d.capacityWh, 0)

  const rows = devs.length
    ? await db
        .select({ deviceId: samples.deviceId, ts: samples.ts, soc: samples.soc })
        .from(samples)
        .where(and(eq(samples.siteId, site.id), eq(samples.kind, 'battery'), gte(samples.ts, from), inArray(samples.deviceId, devs.map((d) => d.id))))
        .orderBy(asc(samples.ts))
    : []

  // 15-min buckets: average per device, then capacity-weighted for the combined level
  const buckets = new Map<number, Map<number, { sum: number; n: number }>>()
  for (const r of rows) {
    if (r.soc == null || r.deviceId == null) continue
    const k = slotStartOf(r.ts).getTime()
    const b = buckets.get(k) ?? new Map()
    const e = b.get(r.deviceId) ?? { sum: 0, n: 0 }
    e.sum += r.soc
    e.n++
    b.set(r.deviceId, e)
    buckets.set(k, b)
  }
  const history = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, b]) => b.size === devs.length)
    .map(([k, b]) => {
      const per = devs.map((d) => b.get(d.id)!.sum / b.get(d.id)!.n)
      return { ts: new Date(k + SLOT_MS / 2), soc: devs.reduce((s, d, i) => s + per[i]! * d.capacityWh, 0) / (capacityWh || 1), devices: per }
    })

  const states = devs.map((d) => d.state as DeviceState)
  const socNow = capacityWh ? devs.reduce((s, d, i) => s + (states[i]!.soc ?? 0) * d.capacityWh, 0) / capacityWh : 0
  const cfg = site.strategy
  const planRows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.siteId, site.id), gte(plans.slotStart, slotStartOf(now))))
    .orderBy(asc(plans.slotStart))
    .limit((FUTURE_H * 3600_000) / SLOT_MS)
  const forecast = projectSoc(socNow, planRows, {
    capacityWh,
    maxChargeW: devs.reduce((s, d) => s + d.maxChargeW, 0),
    maxDischargeW: devs.reduce((s, d) => s + d.maxDischargeW, 0),
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
