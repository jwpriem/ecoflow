import { and, asc, count, desc, eq, gt, lt, or } from 'drizzle-orm'
import type { Db } from '../db/client'
import { integrations, jobRuns, sites, users } from '../db/schema'

/** How often each job runs, in minutes: the schedule in nuxt.config.ts */
export const JOB_SCHEDULE = { collect: 1, vehicles: 5, ledger: 15, strategy: 15, prices: 60, digest: 60, retention: 24 * 60, demo: 5 } as const
export type JobName = keyof typeof JOB_SCHEDULE

const KEEP_MS = 7 * 24 * 60 * 60_000
/** Enough to see what goes wrong without one bad run filling the table */
const MAX_ERRORS = 20

/** Records one run of a job: how long it took, and how many sites failed (threw or answered with an error) or timed out. */
export async function recordRun(db: Db, job: JobName, startedAt: Date, results: Record<number, unknown>, now = new Date()) {
  const errors: { siteId: number; error: string; timedOut: boolean }[] = []
  for (const [siteId, r] of Object.entries(results)) {
    if (r && typeof r === 'object' && 'error' in r && r.error) errors.push({ siteId: Number(siteId), error: String(r.error).slice(0, 300), timedOut: 'timedOut' in r && !!r.timedOut })
  }
  const timedOut = errors.filter((e) => e.timedOut).length
  await db.insert(jobRuns).values({
    job,
    startedAt,
    durationMs: now.getTime() - startedAt.getTime(),
    sitesOk: Object.keys(results).length - errors.length,
    sitesFailed: errors.length - timedOut,
    sitesTimedOut: timedOut,
    errors: errors.slice(0, MAX_ERRORS).map(({ siteId, error }) => ({ siteId, error })),
  })
  await db.delete(jobRuns).where(and(eq(jobRuns.job, job), lt(jobRuns.startedAt, new Date(now.getTime() - KEEP_MS))))
}

/** A job is late when it missed two runs in a row (plus a little slack for a slow tick). */
const lateAfterMs = (job: JobName) => (2 * JOB_SCHEDULE[job] + 2) * 60_000

export async function jobHealth(db: Db, now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000)
  return Promise.all(
    (Object.keys(JOB_SCHEDULE) as JobName[]).map(async (job) => {
      const [last] = await db.select().from(jobRuns).where(eq(jobRuns.job, job)).orderBy(desc(jobRuns.startedAt)).limit(1)
      const [failing] = await db
        .select({ n: count() })
        .from(jobRuns)
        .where(and(eq(jobRuns.job, job), gt(jobRuns.startedAt, dayAgo), or(gt(jobRuns.sitesFailed, 0), gt(jobRuns.sitesTimedOut, 0))))
      return {
        job,
        everyMinutes: JOB_SCHEDULE[job],
        lastRunAt: last?.startedAt ?? null,
        durationMs: last?.durationMs ?? null,
        sitesOk: last?.sitesOk ?? null,
        sitesFailed: last?.sitesFailed ?? null,
        sitesTimedOut: last?.sitesTimedOut ?? null,
        errors: last?.errors ?? [],
        runsWithFailures24h: failing!.n,
        late: !last || now.getTime() - last.startedAt.getTime() > lateAfterMs(job),
      }
    }),
  )
}

/** Connections failing right now, per provider, with the households they belong to and when each last worked. */
export async function providerErrors(db: Db) {
  const rows = await db
    .select({ provider: integrations.provider, siteId: sites.id, household: sites.name, lastError: integrations.lastError, lastOkAt: integrations.lastOkAt })
    .from(integrations)
    .innerJoin(sites, eq(sites.id, integrations.siteId))
    .where(eq(integrations.status, 'error'))
    .orderBy(asc(integrations.provider), asc(sites.id))
  const out = new Map<string, Omit<(typeof rows)[number], 'provider'>[]>()
  for (const { provider, ...r } of rows) out.set(provider, [...(out.get(provider) ?? []), r])
  return [...out].map(([provider, households]) => ({ provider, count: households.length, households }))
}

export async function systemCounts(db: Db) {
  const [u] = await db.select({ n: count() }).from(users)
  const [h] = await db.select({ n: count() }).from(sites)
  const [steering] = await db.select({ n: count() }).from(sites).where(eq(sites.controlMode, 'auto'))
  return { users: u!.n, households: h!.n, steering: steering!.n }
}
