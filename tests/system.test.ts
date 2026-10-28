import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { defaultStrategy } from '../server/lib/types'
import { createAccount } from '../server/services/setup'
import { jobHealth, providerErrors, recordRun, systemCounts } from '../server/services/system'
import { freshDb } from './support/pglite'

const MIN = 60_000

describe('job health', () => {
  let db: Db
  const now = new Date('2026-10-28T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)

  beforeAll(async () => {
    db = await freshDb()
  })

  it('records a run with its duration and the sites that failed, threw or not', async () => {
    await recordRun(db, 'collect', ago(MIN), { 1: { ok: true }, 2: { error: 'Tibber said 401' }, 3: undefined }, ago(MIN - 1500))
    const collect = (await jobHealth(db, now)).find((j) => j.job === 'collect')!
    expect(collect).toMatchObject({ lastRunAt: ago(MIN), durationMs: 1500, sitesOk: 2, sitesFailed: 1, runsWithFailures24h: 1, late: false })
  })

  it('is late after missing two runs, and when it never ran', async () => {
    await recordRun(db, 'ledger', ago(40 * MIN), {}, ago(40 * MIN))
    await recordRun(db, 'prices', ago(50 * MIN), {}, ago(50 * MIN))
    const jobs = Object.fromEntries((await jobHealth(db, now)).map((j) => [j.job, j]))
    expect(jobs.ledger!.late).toBe(true)
    expect(jobs.prices!.late).toBe(false)
    expect(jobs.retention).toMatchObject({ lastRunAt: null, late: true })
  })

  it('keeps a week of runs', async () => {
    await recordRun(db, 'digest', ago(8 * 24 * 60 * MIN), {}, ago(8 * 24 * 60 * MIN))
    await recordRun(db, 'digest', ago(10 * MIN), {}, now)
    expect((await db.select().from(schema.jobRuns)).filter((r) => r.job === 'digest')).toHaveLength(1)
  })
})

describe('system page data', () => {
  let db: Db
  beforeAll(async () => {
    db = await freshDb()
    const a = await createAccount(db, 'owner@example.com', 'owner-password', { siteName: 'Broken home' })
    await db.insert(schema.integrations).values([
      { siteId: a.site.id, provider: 'tibber', credentialsEnc: 'SECRET', status: 'error', lastError: 'Unauthorized' },
      { siteId: a.site.id, provider: 'solaredge', credentialsEnc: 'SECRET', status: 'ok' },
    ])
    // 200 more households, half of them steered, each with a working connection
    const more = await db
      .insert(schema.sites)
      .values(Array.from({ length: 200 }, (_, i) => ({ userId: a.user.id, name: `Home ${i}`, strategy: defaultStrategy, controlMode: i % 2 ? ('auto' as const) : ('manual' as const) })))
      .returning({ id: schema.sites.id })
    await db.insert(schema.integrations).values(more.map((s) => ({ siteId: s.id, provider: 'tibber' as const, credentialsEnc: 'SECRET', status: 'ok' as const })))
  })

  it('lists the failing connections per provider with their households, never the credentials', async () => {
    const errors = await providerErrors(db)
    expect(errors).toEqual([{ provider: 'tibber', count: 1, households: [{ siteId: expect.any(Number), household: 'Broken home', lastError: 'Unauthorized', lastOkAt: null }] }])
    expect(JSON.stringify(errors)).not.toContain('SECRET')
  })

  it('counts users, households and the ones WattsWise steers', async () => {
    expect(await systemCounts(db)).toEqual({ users: 1, households: 201, steering: 100 + 1 })
  })

  it('loads in well under a second with 200 households', async () => {
    const t0 = performance.now()
    await Promise.all([systemCounts(db), jobHealth(db), providerErrors(db)])
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
