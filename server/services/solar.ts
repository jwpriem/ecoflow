import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { ledger, prices, samples, type sites, solarLedger, solarProduction } from '../db/schema'
import { changed } from '../db/upsert'
import { fallbackFeedIn } from '../lib/feedin'
import { bookSolarSlot, type GridMinute, seBucketStart, slotKwh } from '../lib/solar'
import { addMs, slotStartOf } from '../lib/time'
import type { Period } from './ledger'

type Site = typeof sites.$inferSelect
const DAY_MS = 86_400_000
const SOLAR_LEDGER_COLUMNS = ['produced_kwh', 'self_used_kwh', 'exported_kwh', 'to_battery_kwh', 'price_total', 'price_feed_in', 'value_self_used',
  'value_exported', 'value_to_battery']

export async function latestSolarSlot(db: Db, siteId: number): Promise<Date | undefined> {
  const [row] = await db
    .select({ slotStart: solarProduction.slotStart })
    .from(solarProduction)
    .where(eq(solarProduction.siteId, siteId))
    .orderBy(desc(solarProduction.slotStart))
    .limit(1)
  return row?.slotStart
}

/** Keep SolarEdge's quarter-hour buckets; a later read of the same slot replaces the earlier one */
export async function storeSolarProduction(db: Db, site: Site, buckets: { timestamp: string; w: number }[]) {
  const bySlot = new Map<number, number>()
  for (const b of buckets) {
    const start = seBucketStart(b.timestamp, site.timezone)
    if (start) bySlot.set(start.getTime(), b.w)
  }
  if (!bySlot.size) return
  const now = new Date()
  await db
    .insert(solarProduction)
    .values([...bySlot].map(([t, avgW]) => ({ siteId: site.id, slotStart: new Date(t), avgW, updatedAt: now })))
    .onConflictDoUpdate({
      target: [solarProduction.siteId, solarProduction.slotStart],
      set: { avgW: sql.raw('excluded.avg_w'), updatedAt: now },
      setWhere: changed('solar_production', ['avg_w']),
    })
}

/**
 * Book the solar of every complete slot with a SolarEdge reading. The last day is booked again on every
 * run because SolarEdge fills in its buckets late; older slots only when they have not been booked yet.
 * Run after runLedger, which books the solar the batteries took in.
 */
export async function runSolarLedger(db: Db, site: Site, upTo = new Date()): Promise<number> {
  const end = slotStartOf(upTo)
  // Only slots with meter readings can be booked: one without (the collector was down) would otherwise stay
  // the oldest gap forever and make every run book all the days since again
  const [gap] = await db
    .select({ slotStart: sql<Date | null>`min(${solarProduction.slotStart})`.mapWith(solarProduction.slotStart) })
    .from(solarProduction)
    .leftJoin(solarLedger, and(eq(solarLedger.siteId, solarProduction.siteId), eq(solarLedger.slotStart, solarProduction.slotStart)))
    .where(
      and(
        eq(solarProduction.siteId, site.id),
        isNull(solarLedger.slotStart),
        lt(solarProduction.slotStart, end),
        sql`exists (select 1 from ${samples} where ${samples.siteId} = ${solarProduction.siteId} and ${samples.kind} = 'grid'
          and ${samples.ts} >= ${solarProduction.slotStart} and ${samples.ts} < ${solarProduction.slotStart} + interval '15 minutes')`,
      ),
    )
  const recent = end.getTime() - DAY_MS
  const from = new Date(Math.min(recent, gap?.slotStart?.getTime() ?? recent))
  let booked = 0

  for (let chunk = from; chunk < end; chunk = addMs(chunk, DAY_MS)) {
    const chunkEnd = new Date(Math.min(end.getTime(), chunk.getTime() + DAY_MS))
    const production = await db
      .select()
      .from(solarProduction)
      .where(and(eq(solarProduction.siteId, site.id), gte(solarProduction.slotStart, chunk), lt(solarProduction.slotStart, chunkEnd)))
    if (!production.length) continue

    const rows = await db
      .select({ ts: samples.ts, kind: samples.kind, powerW: samples.powerW, pvW: samples.pvW })
      .from(samples)
      .where(and(eq(samples.siteId, site.id), gte(samples.ts, chunk), lt(samples.ts, chunkEnd), inArray(samples.kind, ['grid', 'battery'])))
      .orderBy(asc(samples.ts))
    const grid = new Map<number, GridMinute[]>()
    const pvKwh = new Map<number, number>()
    let prev: number | undefined
    for (const r of rows) {
      const t = r.ts.getTime()
      const slot = slotStartOf(t).getTime()
      if (r.kind === 'grid') {
        const dtSec = prev ? Math.min(300, (t - prev) / 1000) : 60
        prev = t
        if (!grid.has(slot)) grid.set(slot, [])
        grid.get(slot)!.push({ dtSec, gridW: r.powerW })
      } else if (r.pvW) {
        // STREAM's own PV input; the collector reads once a minute
        pvKwh.set(slot, (pvKwh.get(slot) ?? 0) + Math.max(0, r.pvW) / 60 / 1000)
      }
    }

    const charged = await db
      .select({ slotStart: ledger.slotStart, kwh: sql<number>`sum(${ledger.chargedSolarKwh})::float8` })
      .from(ledger)
      .where(and(eq(ledger.siteId, site.id), gte(ledger.slotStart, chunk), lt(ledger.slotStart, chunkEnd)))
      .groupBy(ledger.slotStart)
    const toBattery = new Map(charged.map((c) => [c.slotStart.getTime(), c.kwh]))
    const priceRows = await db
      .select()
      .from(prices)
      .where(and(eq(prices.siteId, site.id), gte(prices.slotStart, chunk), lt(prices.slotStart, chunkEnd)))
    const priceBySlot = new Map(priceRows.map((p) => [p.slotStart.getTime(), p]))

    const out: (typeof solarLedger.$inferInsert)[] = []
    for (const p of production) {
      const t = p.slotStart.getTime()
      const minutes = grid.get(t)
      // Without the meter we cannot tell export from self-use
      if (!minutes?.length) continue
      const price = priceBySlot.get(t)
      const priceTotal = price?.total ?? site.strategy.fallbackPrice
      const priceFeedIn = price?.feedIn ?? fallbackFeedIn(p.slotStart, priceTotal, site.strategy.feedIn, site.timezone)
      const r = bookSolarSlot({
        producedKwh: slotKwh(p.avgW) + (pvKwh.get(t) ?? 0),
        grid: minutes,
        toBatteryKwh: toBattery.get(t) ?? 0,
        priceTotal,
        priceFeedIn,
      })
      out.push({ siteId: site.id, slotStart: p.slotStart, ...r, priceTotal, priceFeedIn })
    }
    if (!out.length) continue
    await db
      .insert(solarLedger)
      .values(out)
      .onConflictDoUpdate({
        target: [solarLedger.siteId, solarLedger.slotStart],
        set: Object.fromEntries(SOLAR_LEDGER_COLUMNS.map((c) => [c.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase()), sql.raw(`excluded.${c}`)])),
        // The last day is booked again on every run; leave the slots that came out the same alone
        setWhere: changed('solar_ledger', SOLAR_LEDGER_COLUMNS),
      })
    booked += out.length
  }
  return booked
}

export async function solarByPeriod(db: Db, site: Site, period: Period, from: Date, to: Date) {
  const bucket = sql`date_trunc(${period}, ${solarLedger.slotStart} at time zone ${site.timezone})`
  return db
    .select({
      bucket: sql<string>`to_char(${bucket}, 'YYYY-MM-DD"T"HH24:MI')`,
      producedKwh: sql<number>`sum(${solarLedger.producedKwh})::float8`,
      selfUsedKwh: sql<number>`sum(${solarLedger.selfUsedKwh})::float8`,
      exportedKwh: sql<number>`sum(${solarLedger.exportedKwh})::float8`,
      toBatteryKwh: sql<number>`sum(${solarLedger.toBatteryKwh})::float8`,
      valueSelfUsed: sql<number>`sum(${solarLedger.valueSelfUsed})::float8`,
      valueExported: sql<number>`sum(${solarLedger.valueExported})::float8`,
      valueToBattery: sql<number>`sum(${solarLedger.valueToBattery})::float8`,
    })
    .from(solarLedger)
    .where(and(eq(solarLedger.siteId, site.id), gte(solarLedger.slotStart, from), lt(solarLedger.slotStart, to)))
    .groupBy(sql`1`)
    .orderBy(sql`1`)
}
