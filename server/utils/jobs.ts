import type { sites } from '../db/schema'
import { JOB_OPTIONS, runSites } from '../services/jobs'
import type { JobName } from '../services/system'

/** Run a background job for every household that has something to do (see services/jobs.ts). Off with NUXT_JOBS_ENABLED=false. */
export async function runJob(name: JobName, fn: (site: typeof sites.$inferSelect) => Promise<unknown>) {
  const cfg = useRuntimeConfig()
  if (String(cfg.jobsEnabled) === 'false') return { skipped: 'jobs disabled' }
  const concurrency = Number(cfg.jobsConcurrency) || undefined
  return runSites(useDb(), name, fn, { ...JOB_OPTIONS[name], ...(concurrency ? { concurrency } : {}) })
}
