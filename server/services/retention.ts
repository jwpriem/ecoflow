import { and, eq, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { batteryPool, devices, samples, type sites } from '../db/schema'
import { MAX_DAYS_PER_RUN, thinUntil } from '../lib/retention'
import { addMs } from '../lib/time'

type Site = typeof sites.$inferSelect
const DAY_MS = 86_400_000

/**
 * Replace the minute samples of old days by 15-min averages, so the table grows by about 400 rows a day
 * instead of 3,000+. The ledgers already hold every euro and kWh; the averages keep the shape for charts.
 * Returns the number of days thinned.
 */
export async function thinSamples(db: Db, site: Site, now = new Date()): Promise<number> {
  const pools = await db
    .select({ nextSlot: batteryPool.nextSlot })
    .from(batteryPool)
    .innerJoin(devices, eq(devices.id, batteryPool.deviceId))
    .where(eq(devices.siteId, site.id))
  const until = thinUntil(now, pools.map((p) => p.nextSlot))

  // The oldest minute sample still there: averaged rows sit exactly on a slot start
  const [oldest] = await db
    .select({ ts: sql<Date | null>`min(${samples.ts})`.mapWith(samples.ts) })
    .from(samples)
    .where(
      and(
        eq(samples.siteId, site.id),
        lt(samples.ts, until),
        sql`${samples.ts} <> date_bin('15 minutes', ${samples.ts}, timestamptz '2000-01-01 00:00:00+00')`,
      ),
    )
  if (!oldest?.ts) return 0

  let days = 0
  for (let day = new Date(Math.floor(oldest.ts.getTime() / DAY_MS) * DAY_MS); day < until && days < MAX_DAYS_PER_RUN; day = addMs(day, DAY_MS)) {
    const dayEnd = addMs(day, DAY_MS)
    // One statement, so a day is either thinned completely or not at all
    await db.execute(sql`
      with gone as (
        delete from ${samples}
        -- Every kind spelled out, so the (site_id, kind, ts) index finds the day
        where site_id = ${site.id} and kind in ('battery', 'grid', 'solar') and ts >= ${day} and ts < ${dayEnd}
        returning site_id, device_id, kind, ts, power_w, soc, pv_w
      )
      insert into ${samples} (site_id, device_id, kind, ts, power_w, soc, pv_w)
      select site_id, device_id, kind, date_bin('15 minutes', ts, timestamptz '2000-01-01 00:00:00+00'), avg(power_w), avg(soc), avg(pv_w)
      from gone
      group by site_id, device_id, kind, 4`)
    days++
  }
  return days
}
