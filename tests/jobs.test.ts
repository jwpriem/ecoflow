import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { defaultStrategy } from '../server/lib/types'
import { claimLock, forEachSite, jobSites, releaseLock, runSites, TimeoutError, withTimeout } from '../server/services/jobs'
import { createAccount } from '../server/services/setup'
import { freshDb } from './support/pglite'

type Site = typeof schema.sites.$inferSelect
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const fakeSites = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }) as Site)

describe('working through households', () => {
  it('times out a hanging household without holding up the others', async () => {
    const done: number[] = []
    const t0 = Date.now()
    const results = await forEachSite(
      fakeSites(5),
      async (site) => {
        if (site.id === 2) await new Promise(() => {})
        await sleep(20)
        done.push(site.id)
        return 'ok'
      },
      { timeoutMs: 200, concurrency: 2 },
    )
    expect(Date.now() - t0).toBeLessThan(600)
    expect(done.sort()).toEqual([1, 3, 4, 5])
    expect(results[2]).toEqual({ error: 'Timed out after 0 s', timedOut: true })
    expect(results[1]).toBe('ok')
  })

  it('keeps to the concurrency and reports a thrown error per household', async () => {
    let running = 0
    let most = 0
    const results = await forEachSite(
      fakeSites(10),
      async (site) => {
        most = Math.max(most, ++running)
        await sleep(10)
        running--
        if (site.id === 7) throw new Error('EcoFlow said no')
      },
      { timeoutMs: 1000, concurrency: 3 },
    )
    expect(most).toBe(3)
    expect(results[7]).toEqual({ error: 'EcoFlow said no' })
  })

  it('collects for 200 households with slow providers well within a minute', async () => {
    const t0 = Date.now()
    await forEachSite(fakeSites(200), () => sleep(50), { timeoutMs: 45_000 })
    // 200 × 50 ms one by one would take 10 s; 8 at a time takes about 1.3 s
    expect(Date.now() - t0).toBeLessThan(5000)
  })

  it('rejects with a TimeoutError', async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toBeInstanceOf(TimeoutError)
    expect(await withTimeout(Promise.resolve(1), 10)).toBe(1)
  })
})

describe('job runs', () => {
  let db: Db
  let connected: number
  let empty: number

  beforeEach(async () => {
    db = await freshDb()
    const a = await createAccount(db, 'owner@example.com', 'owner-password')
    connected = a.site.id
    await db.insert(schema.integrations).values({ siteId: connected, provider: 'tibber', credentialsEnc: 'x' })
    const [e] = await db.insert(schema.sites).values({ userId: a.user.id, name: 'Nothing connected', strategy: defaultStrategy }).returning()
    empty = e!.id
  })

  it('gives the lock to one holder until it is released or its lease runs out', async () => {
    expect(await claimLock(db, 'collect', 'a', 60_000)).toBe(true)
    expect(await claimLock(db, 'collect', 'b', 60_000)).toBe(false)
    expect(await claimLock(db, 'ledger', 'b', 60_000)).toBe(true)
    await releaseLock(db, 'collect', 'a')
    expect(await claimLock(db, 'collect', 'b', 60_000)).toBe(true)
    // A runner that died: its lease ends and someone else takes over
    expect(await claimLock(db, 'collect', 'c', 60_000, new Date(Date.now() + 61_000))).toBe(true)
  })

  it('lets only one of two runners at the same time do the work', async () => {
    const calls: number[] = []
    const work = (site: Site) => sleep(100).then(() => calls.push(site.id))
    const [one, two] = await Promise.all([
      runSites(db, 'collect', work, { timeoutMs: 1000, skipEmpty: true }, 'first'),
      runSites(db, 'collect', work, { timeoutMs: 1000, skipEmpty: true }, 'second'),
    ])
    expect([one, two].filter((r) => 'skipped' in r)).toEqual([{ skipped: 'locked' }])
    expect(calls).toEqual([connected])
    // Released afterwards: the next tick runs
    expect('skipped' in (await runSites(db, 'collect', work, { timeoutMs: 1000 }))).toBe(false)
  })

  it('skips households without a connection, except for retention', async () => {
    expect((await jobSites(db, true)).map((s) => s.id)).toEqual([connected])
    expect((await jobSites(db)).map((s) => s.id)).toEqual([connected, empty])
  })

  it('records the run with its timeouts and errors', async () => {
    await runSites(
      db,
      'retention',
      async (site) => {
        if (site.id === empty) await new Promise(() => {})
        return { thinned: 0 }
      },
      { timeoutMs: 100 },
    )
    await runSites(db, 'prices', () => Promise.reject(new Error('Tibber is down')), { timeoutMs: 100, skipEmpty: true })
    const runs = await db.select().from(schema.jobRuns).orderBy(schema.jobRuns.id)
    expect(runs.map(({ job, sitesOk, sitesFailed, sitesTimedOut, errors }) => ({ job, sitesOk, sitesFailed, sitesTimedOut, errors }))).toEqual([
      { job: 'retention', sitesOk: 1, sitesFailed: 0, sitesTimedOut: 1, errors: [{ siteId: empty, error: 'Timed out after 0 s' }] },
      { job: 'prices', sitesOk: 0, sitesFailed: 1, sitesTimedOut: 0, errors: [{ siteId: connected, error: 'Tibber is down' }] },
    ])
  })
})
