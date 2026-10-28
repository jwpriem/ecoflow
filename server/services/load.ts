import { and, eq, gt, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { samples, sites } from '../db/schema'
import { defaultStrategy } from '../lib/types'

type Site = typeof sites.$inferSelect

const DAYS = 14
/** At least a day of minutes with a meter reading before the average says anything */
const MIN_MINUTES = 1440

/**
 * The house's average draw over the last 14 days, without the batteries: the Pulse's grid power per minute
 * minus what the batteries took (charging) or gave (discharging) in that minute. Export counts as zero, since
 * the batteries can't discharge into it. Null without enough Pulse history.
 */
export async function typicalLoadW(db: Db, siteId: number, now = new Date()): Promise<number | null> {
  const since = new Date(now.getTime() - DAYS * 24 * 60 * 60_000)
  const perMinute = db
    .select({
      net: sql<number>`sum(CASE WHEN ${samples.kind} = 'grid' THEN ${samples.powerW} ELSE -${samples.powerW} END)`.as('net'),
      hasGrid: sql<boolean>`bool_or(${samples.kind} = 'grid')`.as('has_grid'),
    })
    .from(samples)
    .where(and(eq(samples.siteId, siteId), gt(samples.ts, since), sql`${samples.kind} IN ('grid', 'battery')`))
    .groupBy(samples.ts)
    .as('per_minute')
  const [row] = await db
    .select({ avg: sql<number | null>`avg(greatest(${perMinute.net}, 0))`, minutes: sql<number>`count(*)::int` })
    .from(perMinute)
    .where(sql`${perMinute.hasGrid}`)
  if (!row || row.minutes < MIN_MINUTES || row.avg === null) return null
  return Math.min(5000, Math.max(50, Math.round(Number(row.avg) / 10) * 10))
}

/** When the household has the typical load on auto, store the latest average. Returns the value now in use. */
export async function refreshTypicalLoad(db: Db, site: Site, now = new Date()): Promise<number> {
  const cfg = { ...defaultStrategy, ...site.strategy }
  if (!cfg.avgLoadAuto) return cfg.avgLoadW
  const avgLoadW = (await typicalLoadW(db, site.id, now)) ?? defaultStrategy.avgLoadW
  if (avgLoadW !== cfg.avgLoadW) await db.update(sites).set({ strategy: { ...cfg, avgLoadW } }).where(eq(sites.id, site.id))
  return avgLoadW
}
