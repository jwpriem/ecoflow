import { and, asc, eq, gte, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { prices, type sites } from '../db/schema'
import { changed } from '../db/upsert'
import { feedInPrice } from '../lib/feedin'
import { pricesMessage } from '../lib/notifications'
import { addMs, SLOT_MS, slotStartOf, startOfLocalDay } from '../lib/time'
import type { PriceSlot } from '../lib/types'
import { tibberPrices, type TibberCredentials } from '../providers/tibber'
import { getIntegration, markIntegration } from './integrations'
import { notify } from './push'

type Site = typeof sites.$inferSelect

export async function upsertPrices(db: Db, rows: (typeof prices.$inferInsert)[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(prices)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [prices.siteId, prices.slotStart],
        set: {
          energy: sql`excluded.energy`,
          tax: sql`excluded.tax`,
          total: sql`excluded.total`,
          feedIn: sql`excluded.feed_in`,
          source: sql`excluded.source`,
          slotMinutes: sql`excluded.slot_minutes`,
        },
        setWhere: changed('prices', ['energy', 'tax', 'total', 'feed_in', 'source', 'slot_minutes']),
      })
  }
}

/** Fetch today + tomorrow from Tibber. Without a Tibber connection there are no prices (the strategy then uses fallbackPrice). */
export async function refreshPrices(db: Db, site: Site, key: string): Promise<{ source: 'tibber' | null; count: number }> {
  const tibber = await getIntegration<TibberCredentials>(db, site.id, 'tibber', key)
  const homeId = tibber?.meta.homeId as string | undefined
  if (tibber && homeId) {
    try {
      const list = await tibberPrices(tibber.creds, homeId)
      const rows = list.flatMap((p, i) => {
        const start = new Date(p.startsAt)
        const next = list[i + 1] ? new Date(list[i + 1]!.startsAt) : addMs(start, SLOT_MS)
        const minutes = Math.round((next.getTime() - start.getTime()) / 60_000)
        // If Tibber only returns hourly prices, spread them over 15-min slots so everything else stays uniform
        const parts = minutes >= 60 ? 4 : 1
        return Array.from({ length: parts }, (_, k) => {
          const slotStart = addMs(start, k * SLOT_MS)
          return {
            siteId: site.id,
            slotStart,
            slotMinutes: 15,
            energy: p.energy,
            tax: p.tax,
            total: p.total,
            feedIn: feedInPrice(slotStart, p.energy, p.total, site.strategy.feedIn),
            source: 'tibber' as const,
          }
        })
      })
      // Tomorrow's prices are published once a day (around 13:00); notify when they first show up
      const tomorrow = startOfLocalDay(addMs(startOfLocalDay(new Date(), site.timezone), 36 * 3600_000), site.timezone)
      const dayAfter = startOfLocalDay(addMs(tomorrow, 36 * 3600_000), site.timezone)
      const hadTomorrow = (await getPrices(db, site.id, tomorrow, dayAfter)).some((p) => p.source === 'tibber')
      await upsertPrices(db, rows)
      await markIntegration(db, tibber.row.id)
      if (!hadTomorrow) {
        const msg = pricesMessage(rows.filter((r) => r.slotStart >= tomorrow && r.slotStart < dayAfter) as PriceSlot[], site.timezone)
        if (msg) await notify(db, site.id, 'prices', msg)
      }
      return { source: 'tibber', count: rows.length }
    } catch (err) {
      await markIntegration(db, tibber.row.id, (err as Error).message)
      throw err
    }
  }
  return { source: null, count: 0 }
}

export async function getPrices(db: Db, siteId: number, from: Date, to: Date): Promise<(PriceSlot & { source: string })[]> {
  const rows = await db
    .select()
    .from(prices)
    .where(and(eq(prices.siteId, siteId), gte(prices.slotStart, from), lt(prices.slotStart, to)))
    .orderBy(asc(prices.slotStart))
  return rows.map((r) => ({ slotStart: r.slotStart, total: r.total, energy: r.energy, feedIn: r.feedIn, source: r.source }))
}
