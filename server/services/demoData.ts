import { and, asc, eq, inArray, lt, max } from 'drizzle-orm'
import type { Db } from '../db/client'
import { commandsLog, devices, irradiance, ledger, plans, prices, samples, type sites, solarLedger, solarProduction } from '../db/schema'
import { DEMO_STEP_MS, type DemoDay, demoDay, localDateKey } from '../lib/demoSim'
import { addMs, localHour, SLOT_MS, startOfLocalDay } from '../lib/time'
import { defaultStrategy } from '../lib/types'
import { setLive } from './collector'
import { runLedger } from './ledger'
import { upsertPrices } from './prices'
import { runSolarLedger } from './solar'
import { runStrategy } from './strategy'

type Site = typeof sites.$inferSelect
const DAY_MS = 86_400_000
/** The demo keeps about two months of history */
export const DEMO_DAYS = 60

/**
 * One run for the demo household (every 5 minutes): write the readings from the last one up to now (two months
 * on the first run), the prices and sun for today and, from 13:00, tomorrow, then book them with the real
 * ledgers, plan with the real planner and show the latest reading as live. Older than two months is removed.
 */
export async function demoTick(db: Db, site: Site, now = new Date(), historyDays = DEMO_DAYS) {
  const devs = await db.select().from(devices).where(eq(devices.siteId, site.id)).orderBy(asc(devices.id))
  if (!devs.length) return { written: 0 }
  const cfg = { ...defaultStrategy, ...site.strategy }
  const tz = site.timezone
  const windowStart = startOfLocalDay(new Date(now.getTime() - historyDays * DAY_MS), tz)

  const [last] = await db.select({ ts: max(samples.ts) }).from(samples).where(and(eq(samples.siteId, site.id), eq(samples.kind, 'grid')))
  const from = last?.ts && last.ts > windowStart ? addMs(last.ts, DEMO_STEP_MS) : windowStart

  const days = new Map<string, DemoDay>()
  const day = (d: Date) => {
    const key = localDateKey(d, tz)
    if (!days.has(key)) days.set(key, demoDay(key, cfg, tz))
    return days.get(key)!
  }

  // Readings: every 5 minutes, the grid, the solar and each battery (the system's power split over the units)
  const rows: (typeof samples.$inferInsert)[] = []
  for (let t = startOfLocalDay(from, tz); t <= now; t = startOfLocalDay(addMs(t, 36 * 3600_000), tz)) {
    for (const p of day(t).points) {
      if (p.ts < from || p.ts > now) continue
      rows.push({ siteId: site.id, ts: p.ts, kind: 'grid', powerW: p.gridW })
      rows.push({ siteId: site.id, ts: p.ts, kind: 'solar', powerW: p.solarW })
      for (const d of devs) rows.push({ siteId: site.id, deviceId: d.id, ts: p.ts, kind: 'battery', powerW: p.batteryW / devs.length, soc: p.soc, pvW: 0 })
    }
  }
  for (let i = 0; i < rows.length; i += 2000) await db.insert(samples).values(rows.slice(i, i + 2000))

  // Prices, sun and solar production for every day touched, today, and tomorrow once its prices are "published"
  const today = startOfLocalDay(now, tz)
  const tomorrow = startOfLocalDay(addMs(today, 36 * 3600_000), tz)
  if (localHour(now, tz) >= 13) day(tomorrow)
  day(today)
  for (const d of days.values()) {
    await upsertPrices(db, d.prices.map((p) => ({ siteId: site.id, slotStart: p.slotStart, slotMinutes: 15, energy: p.energy, tax: p.tax, total: p.total, feedIn: p.feedIn, source: 'tibber' as const })))
    const slots = d.prices.map((p) => p.slotStart)
    await db
      .insert(irradiance)
      .values(slots.map((slotStart, i) => ({ siteId: site.id, slotStart, ghi: d.ghi[i]! })))
      .onConflictDoNothing()
    const done = slots.map((slotStart, i) => ({ slotStart, avgW: d.solarSlotW[i]! })).filter((s) => s.slotStart.getTime() + SLOT_MS <= now.getTime())
    if (done.length) await db.insert(solarProduction).values(done.map((s) => ({ siteId: site.id, ...s }))).onConflictDoNothing()
  }

  // The real ledgers book the new readings, then the real planner plans (the demo never sends: "skipped: demo")
  const booked = await runLedger(db, site, now)
  await runSolarLedger(db, site, now)

  // The latest reading is what Home shows as live
  const point = day(now).points.filter((p) => p.ts <= now).at(-1)
  if (point) {
    for (const d of devs) {
      const state = { ...(d.state as Record<string, unknown>), soc: point.soc, powerW: point.batteryW / devs.length, pvW: 0, online: true, ts: point.ts.toISOString() }
      await db.update(devices).set({ state }).where(eq(devices.id, d.id))
    }
    setLive(site.id, {
      ts: point.ts.toISOString(),
      gridW: point.gridW,
      houseNetW: point.loadW - point.solarW,
      solarW: point.solarW,
      houseSource: 'pulse',
      solarSource: 'solaredge',
    })
  }
  await runStrategy(db, site, now)

  await pruneDemo(db, site.id, devs.map((d) => d.id), windowStart)
  return { written: rows.length, booked }
}

/** Everything of the demo household from before its two-month window */
async function pruneDemo(db: Db, siteId: number, deviceIds: number[], before: Date) {
  await db.delete(samples).where(and(eq(samples.siteId, siteId), lt(samples.ts, before)))
  await db.delete(prices).where(and(eq(prices.siteId, siteId), lt(prices.slotStart, before)))
  await db.delete(irradiance).where(and(eq(irradiance.siteId, siteId), lt(irradiance.slotStart, before)))
  await db.delete(solarProduction).where(and(eq(solarProduction.siteId, siteId), lt(solarProduction.slotStart, before)))
  await db.delete(solarLedger).where(and(eq(solarLedger.siteId, siteId), lt(solarLedger.slotStart, before)))
  await db.delete(ledger).where(and(eq(ledger.siteId, siteId), lt(ledger.slotStart, before)))
  await db.delete(plans).where(and(eq(plans.siteId, siteId), lt(plans.slotStart, before)))
  if (deviceIds.length) await db.delete(commandsLog).where(and(inArray(commandsLog.deviceId, deviceIds), lt(commandsLog.ts, before)))
}

/** What the live connections report for the demo household: it has none, but must not look broken */
export const demoPulseStatus = (now = Date.now()) => ({ connected: true, lastMessageAt: now })
