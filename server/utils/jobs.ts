import { sql } from 'drizzle-orm'
import { sites } from '../db/schema'
import { type JobName, recordRun } from '../services/system'

const LOCK_KEYS: Record<JobName, number> = { collect: 7101, ledger: 7102, strategy: 7103, prices: 7104, digest: 7105, vehicles: 7106, retention: 7107 }

/**
 * Run a background job for every site, holding a Postgres advisory lock for the duration.
 * If App Platform runs more than one instance, only one does the work.
 */
export async function runJob(name: JobName, fn: (site: typeof sites.$inferSelect) => Promise<unknown>) {
  const cfg = useRuntimeConfig()
  if (String(cfg.jobsEnabled) === 'false') return { skipped: 'jobs disabled' }
  const db = useDb()
  const startedAt = new Date()
  const out = await db.transaction(async (tx) => {
    const res = await tx.execute(sql`select pg_try_advisory_xact_lock(${LOCK_KEYS[name]}) as locked`)
    const locked = (res as unknown as { locked: boolean }[])[0]?.locked
    if (!locked) return { skipped: 'locked' }
    const all = await db.select().from(sites)
    const results: Record<number, unknown> = {}
    for (const site of all) {
      try {
        results[site.id] = await fn(site)
      } catch (err) {
        console.error(`[job:${name}] site ${site.id}:`, (err as Error).message)
        results[site.id] = { error: (err as Error).message }
      }
    }
    return results
  })
  // Only runs that did the work count for job health; another instance holding the lock is not a run
  if (!('skipped' in out)) await recordRun(db, name, startedAt, out).catch((err: Error) => console.warn(`[job:${name}] run not recorded:`, err.message))
  return out
}
