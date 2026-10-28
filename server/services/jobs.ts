import { randomUUID } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import type { Db } from '../db/client'
import { integrations, jobLocks, sites } from '../db/schema'
import { type JobName, recordRun } from './system'

type Site = typeof sites.$inferSelect

export interface JobOptions {
  /** How long one household may take before it counts as timed out */
  timeoutMs: number
  /** Households worked on at the same time */
  concurrency?: number
  /** Leave out households without any connection: there is nothing to read, book or steer */
  skipEmpty?: boolean
  /** How long the lock holds if the runner dies without giving it back */
  leaseMs?: number
}

/** Per job: the timeout fits its work (a collect tick must finish inside its minute). Retention also thins old samples of households that disconnected. */
export const JOB_OPTIONS: Record<JobName, JobOptions> = {
  collect: { timeoutMs: 45_000, skipEmpty: true },
  vehicles: { timeoutMs: 90_000, skipEmpty: true },
  ledger: { timeoutMs: 120_000, skipEmpty: true },
  strategy: { timeoutMs: 60_000, skipEmpty: true },
  prices: { timeoutMs: 120_000, skipEmpty: true },
  digest: { timeoutMs: 60_000, skipEmpty: true },
  retention: { timeoutMs: 600_000 },
}

export const DEFAULT_CONCURRENCY = 8
const DEFAULT_LEASE_MS = 15 * 60_000

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${Math.round(ms / 1000)} s`)
  }
}

/**
 * The promise, or a TimeoutError once `ms` has passed. The work itself can't be cancelled and may still finish
 * in the background, but nothing waits for it any more.
 */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new TimeoutError(ms)), ms)))]).finally(() =>
    clearTimeout(timer),
  )
}

/** Runs `fn` for every item, at most `concurrency` at a time, in the items' order. */
export async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker))
}

/** Takes the job's lock when it is free or its lease ran out. True when this holder has it. */
export async function claimLock(db: Db, job: string, holder: string, leaseMs = DEFAULT_LEASE_MS, now = new Date()) {
  const lockedUntil = new Date(now.getTime() + leaseMs)
  const rows = await db
    .insert(jobLocks)
    .values({ job, holder, lockedUntil })
    .onConflictDoUpdate({ target: jobLocks.job, set: { holder, lockedUntil }, setWhere: lt(jobLocks.lockedUntil, now) })
    .returning({ holder: jobLocks.holder })
  return rows[0]?.holder === holder
}

export async function releaseLock(db: Db, job: string, holder: string) {
  await db.update(jobLocks).set({ lockedUntil: new Date(0) }).where(and(eq(jobLocks.job, job), eq(jobLocks.holder, holder)))
}

/** The households a job works on: all of them, or only those with at least one connection. */
export async function jobSites(db: Db, skipEmpty = false): Promise<Site[]> {
  const all = await db.select().from(sites).orderBy(sites.id)
  if (!skipEmpty) return all
  const connected = new Set((await db.selectDistinct({ siteId: integrations.siteId }).from(integrations)).map((r) => r.siteId))
  return all.filter((s) => connected.has(s.id))
}

/**
 * Works through `sites`, a few at a time, each within its timeout. One slow or failing household never holds
 * up the others. Returns the outcome per site: what `fn` returned, or `{ error }` (with `timedOut` on a timeout).
 */
export async function forEachSite(
  list: Site[],
  fn: (site: Site) => Promise<unknown>,
  { timeoutMs, concurrency = DEFAULT_CONCURRENCY }: Pick<JobOptions, 'timeoutMs' | 'concurrency'>,
  log: (site: Site, err: Error) => void = () => {},
) {
  const results: Record<number, unknown> = {}
  await pool(list, concurrency, async (site) => {
    try {
      results[site.id] = await withTimeout(Promise.resolve().then(() => fn(site)), timeoutMs)
    } catch (err) {
      log(site, err as Error)
      results[site.id] = { error: (err as Error).message, ...(err instanceof TimeoutError ? { timedOut: true } : {}) }
    }
  })
  return results
}

/**
 * One run of a background job. Only one runner at a time does the work, across instances, through a lease in
 * job_locks instead of a transaction held open for the whole run. Each run is recorded for the admin's job health.
 */
export async function runSites(db: Db, job: JobName, fn: (site: Site) => Promise<unknown>, opts: JobOptions = JOB_OPTIONS[job], holder = randomUUID()) {
  if (!(await claimLock(db, job, holder, opts.leaseMs))) return { skipped: 'locked' as const }
  const startedAt = new Date()
  try {
    const list = await jobSites(db, opts.skipEmpty)
    const results = await forEachSite(list, fn, opts, (site, err) => console.error(`[job:${job}] site ${site.id}:`, err.message))
    await recordRun(db, job, startedAt, results).catch((err: Error) => console.warn(`[job:${job}] run not recorded:`, err.message))
    return results
  } finally {
    await releaseLock(db, job, holder).catch((err: Error) => console.warn(`[job:${job}] lock not released:`, err.message))
  }
}
