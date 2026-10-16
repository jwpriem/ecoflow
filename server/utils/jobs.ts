import { sql } from 'drizzle-orm'
import { sites } from '../db/schema'

const LOCK_KEYS: Record<string, number> = { collect: 7101, ledger: 7102, strategy: 7103, prices: 7104 }

/**
 * Run a background job for every site, holding a Postgres advisory lock for the duration.
 * If App Platform runs more than one instance, only one does the work.
 */
export async function runJob(name: keyof typeof LOCK_KEYS, fn: (site: typeof sites.$inferSelect) => Promise<unknown>) {
  const cfg = useRuntimeConfig()
  if (String(cfg.jobsEnabled) === 'false') return { skipped: 'jobs disabled' }
  const db = useDb()
  return db.transaction(async (tx) => {
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
}
