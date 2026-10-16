import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { batteryPool, devices, ledger, prices, samples, type sites } from '../db/schema'
import { bookSlot, type LedgerSample, type Pool } from '../lib/ledger'
import { addMs, SLOT_MS, slotStartOf } from '../lib/time'

type Site = typeof sites.$inferSelect
const DAY_MS = 86_400_000

interface Moment {
  gridW: number
  batteries: Map<number, { w: number; pv: number; soc: number | null }>
}

/** Book all complete 15-min slots that have not been booked yet, for every battery of the site. */
export async function runLedger(db: Db, site: Site, upTo = new Date()): Promise<number> {
  const end = slotStartOf(upTo) // slots before this one are complete
  const devs = await db.select().from(devices).where(eq(devices.siteId, site.id))
  if (!devs.length) return 0

  const poolRows = await db.select().from(batteryPool).where(inArray(batteryPool.deviceId, devs.map((d) => d.id)))
  const pools = new Map<number, Pool & { nextSlot: Date }>()
  for (const p of poolRows) pools.set(p.deviceId, { kwh: p.kwh, costNaive: p.costNaive, costOpportunity: p.costOpportunity, nextSlot: p.nextSlot })

  for (const d of devs) {
    if (pools.has(d.id)) continue
    const [first] = await db
      .select()
      .from(samples)
      .where(and(eq(samples.deviceId, d.id), eq(samples.kind, 'battery')))
      .orderBy(asc(samples.ts))
      .limit(1)
    if (!first) continue
    // Energy already in the battery when we start counting is booked at zero cost
    pools.set(d.id, { kwh: ((first.soc ?? 0) * d.capacityWh) / 1000, costNaive: 0, costOpportunity: 0, nextSlot: slotStartOf(first.ts) })
  }
  if (!pools.size) return 0

  const from = new Date(Math.min(...[...pools.values()].map((p) => p.nextSlot.getTime())))
  const capacity = new Map(devs.map((d) => [d.id, d.capacityWh]))
  const prevTs = new Map<number, number>()
  let booked = 0

  for (let chunk = from; chunk < end; chunk = addMs(chunk, DAY_MS)) {
    const chunkEnd = new Date(Math.min(end.getTime(), chunk.getTime() + DAY_MS))
    const rows = await db
      .select()
      .from(samples)
      .where(and(eq(samples.siteId, site.id), gte(samples.ts, chunk), lt(samples.ts, chunkEnd), inArray(samples.kind, ['battery', 'grid'])))
      .orderBy(asc(samples.ts))
    const priceRows = await db
      .select()
      .from(prices)
      .where(and(eq(prices.siteId, site.id), gte(prices.slotStart, chunk), lt(prices.slotStart, chunkEnd)))
    const priceBySlot = new Map(priceRows.map((p) => [p.slotStart.getTime(), p]))

    // Group readings taken at the same moment
    const moments = new Map<number, Moment>()
    for (const r of rows) {
      const t = r.ts.getTime()
      let m = moments.get(t)
      if (!m) moments.set(t, (m = { gridW: 0, batteries: new Map() }))
      if (r.kind === 'grid') m.gridW = r.powerW
      else if (r.deviceId) m.batteries.set(r.deviceId, { w: r.powerW, pv: r.pvW ?? 0, soc: r.soc })
    }
    const bySlot = new Map<number, [number, Moment][]>()
    for (const [t, m] of moments) {
      const s = slotStartOf(t).getTime()
      if (!bySlot.has(s)) bySlot.set(s, [])
      bySlot.get(s)!.push([t, m])
    }

    const ledgerRows: (typeof ledger.$inferInsert)[] = []
    for (let slot = chunk; slot < chunkEnd; slot = addMs(slot, SLOT_MS)) {
      const price = priceBySlot.get(slot.getTime())
      const priceTotal = price?.total ?? site.strategy.fallbackPrice
      const priceFeedIn = price?.feedIn ?? priceTotal
      const moms = bySlot.get(slot.getTime()) ?? []

      for (const [deviceId, pool] of pools) {
        if (pool.nextSlot > slot) continue
        const ls: LedgerSample[] = []
        let lastSoc: number | null = null
        for (const [t, m] of moms) {
          const b = m.batteries.get(deviceId)
          if (!b) continue
          const prev = prevTs.get(deviceId)
          const dtSec = prev ? Math.min(300, (t - prev) / 1000) : 60
          prevTs.set(deviceId, t)
          let totalChargeW = 0
          for (const o of m.batteries.values()) totalChargeW += Math.max(0, o.w)
          ls.push({ dtSec, batteryW: b.w, pvW: b.pv, totalChargeW, gridW: m.gridW })
          if (b.soc !== null) lastSoc = b.soc
        }
        pool.nextSlot = addMs(slot, SLOT_MS)
        if (!ls.length) continue
        const measuredKwh = lastSoc !== null ? (lastSoc * capacity.get(deviceId)!) / 1000 : undefined
        const r = bookSlot({ pool, samples: ls, priceTotal, priceFeedIn, measuredKwh })
        pool.kwh = r.pool.kwh
        pool.costNaive = r.pool.costNaive
        pool.costOpportunity = r.pool.costOpportunity
        ledgerRows.push({
          deviceId,
          siteId: site.id,
          slotStart: slot,
          chargedSolarKwh: r.chargedSolarKwh,
          chargedGridKwh: r.chargedGridKwh,
          dischargedKwh: r.dischargedKwh,
          priceTotal,
          priceFeedIn,
          costNaive: r.costNaive,
          costOpportunity: r.costOpportunity,
          valueDischarged: r.valueDischarged,
          savingNaive: r.savingNaive,
          savingOpportunity: r.savingOpportunity,
          lossKwh: r.lossKwh,
          socEnd: lastSoc,
        })
      }
    }

    for (let i = 0; i < ledgerRows.length; i += 1000) {
      await db
        .insert(ledger)
        .values(ledgerRows.slice(i, i + 1000))
        .onConflictDoUpdate({
          target: [ledger.deviceId, ledger.slotStart],
          set: Object.fromEntries(
            ['charged_solar_kwh', 'charged_grid_kwh', 'discharged_kwh', 'price_total', 'price_feed_in', 'cost_naive', 'cost_opportunity',
              'value_discharged', 'saving_naive', 'saving_opportunity', 'loss_kwh', 'soc_end'].map((c) => [
              c.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase()),
              sql.raw(`excluded.${c}`),
            ]),
          ),
        })
    }
    booked += ledgerRows.length

    for (const [deviceId, p] of pools) {
      await db
        .insert(batteryPool)
        .values({ deviceId, kwh: p.kwh, costNaive: p.costNaive, costOpportunity: p.costOpportunity, nextSlot: p.nextSlot, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: batteryPool.deviceId,
          set: { kwh: p.kwh, costNaive: p.costNaive, costOpportunity: p.costOpportunity, nextSlot: p.nextSlot, updatedAt: new Date() },
        })
    }
  }
  return booked
}

export type Period = 'hour' | 'day' | 'week' | 'month' | 'year'

export async function savingsByPeriod(db: Db, site: Site, period: Period, from: Date, to: Date) {
  const bucket = sql`date_trunc(${period}, ${ledger.slotStart} at time zone ${site.timezone})`
  const rows = await db
    .select({
      bucket: sql<string>`to_char(${bucket}, 'YYYY-MM-DD"T"HH24:MI')`,
      chargedSolarKwh: sql<number>`sum(${ledger.chargedSolarKwh})::float8`,
      chargedGridKwh: sql<number>`sum(${ledger.chargedGridKwh})::float8`,
      dischargedKwh: sql<number>`sum(${ledger.dischargedKwh})::float8`,
      costNaive: sql<number>`sum(${ledger.costNaive})::float8`,
      costOpportunity: sql<number>`sum(${ledger.costOpportunity})::float8`,
      valueDischarged: sql<number>`sum(${ledger.valueDischarged})::float8`,
      savingNaive: sql<number>`sum(${ledger.savingNaive})::float8`,
      savingOpportunity: sql<number>`sum(${ledger.savingOpportunity})::float8`,
      lossKwh: sql<number>`sum(${ledger.lossKwh})::float8`,
    })
    .from(ledger)
    .where(and(eq(ledger.siteId, site.id), gte(ledger.slotStart, from), lt(ledger.slotStart, to)))
    // positional: the bucket expression has bound parameters, so it cannot be repeated verbatim
    .groupBy(sql`1`)
    .orderBy(sql`1`)
  return rows
}
