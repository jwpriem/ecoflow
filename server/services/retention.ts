import { and, eq, isNull, isNotNull, lt, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { authTokens, batteryPool, commandsLog, devices, householdInvites, jobRuns, samples, sessions, type sites, vehicleSamples } from '../db/schema'
import { KEEP, MAX_DAYS_PER_RUN, thinUntil } from '../lib/retention'
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
    // db.execute passes values to the driver as they are, without the column's mapping: postgres-js
    // can't send a Date there (TypeError in Buffer.byteLength), so the bounds go as ISO strings.
    const from = day.toISOString()
    const to = dayEnd.toISOString()
    // One statement, so a day is either thinned completely or not at all
    await db.execute(sql`
      with gone as (
        delete from ${samples}
        -- Every kind spelled out, so the (site_id, kind, ts) index finds the day
        where site_id = ${site.id} and kind in ('battery', 'grid', 'solar') and ts >= ${from}::timestamptz and ts < ${to}::timestamptz
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

/** Delete what has outlived its use (lib/retention.ts KEEP), for every household at once. Returns rows deleted per table. */
export async function purgeExpired(db: Db, now = new Date()) {
  const ago = (days: number) => addMs(now, -days * DAY_MS)
  const n = async (q: Promise<unknown[]>) => (await q).length
  const usedBefore = ago(KEEP.usedTokenDays)
  return {
    sessions: await n(db.delete(sessions).where(lt(sessions.expiresAt, ago(KEEP.expiredSessionDays))).returning({ id: sessions.id })),
    authTokens: await n(
      db
        .delete(authTokens)
        .where(or(lt(authTokens.expiresAt, usedBefore), and(isNotNull(authTokens.usedAt), lt(authTokens.usedAt, usedBefore))))
        .returning({ id: authTokens.id }),
    ),
    invites: await n(
      db
        .delete(householdInvites)
        .where(and(isNull(householdInvites.acceptedAt), lt(householdInvites.expiresAt, usedBefore)))
        .returning({ id: householdInvites.id }),
    ),
    jobRuns: await n(db.delete(jobRuns).where(lt(jobRuns.startedAt, ago(KEEP.jobRunDays))).returning({ id: jobRuns.id })),
    commands: await n(db.delete(commandsLog).where(lt(commandsLog.ts, ago(KEEP.commandDays))).returning({ id: commandsLog.id })),
    vehicleSamples: await n(db.delete(vehicleSamples).where(lt(vehicleSamples.ts, ago(KEEP.vehicleSampleDays))).returning({ id: vehicleSamples.id })),
  }
}
