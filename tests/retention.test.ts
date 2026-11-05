import { eq, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { samples } from '../server/db/schema'
import { isThinned, MAX_DAYS_PER_RUN, RAW_DAYS, thinUntil } from '../server/lib/retention'
import { thinSamples } from '../server/services/retention'
import { createAccount } from '../server/services/setup'
import { freshDb } from './support/pglite'

const DAY_MS = 86_400_000
const now = new Date('2026-12-30T02:40:00Z')

describe('thinUntil', () => {
  it('keeps the last RAW_DAYS of minutes, cut on a day boundary', () => {
    const until = thinUntil(now, [now])
    expect(until.toISOString()).toBe('2026-10-31T00:00:00.000Z')
    expect(now.getTime() - until.getTime()).toBeGreaterThanOrEqual(RAW_DAYS * DAY_MS)
  })

  it('never thins minutes the battery ledger has not booked yet', () => {
    // A battery whose ledger stalled on 20 October keeps its minutes from the day before on
    const until = thinUntil(now, [now, new Date('2026-10-20T13:15:00Z')])
    expect(until.toISOString()).toBe('2026-10-19T00:00:00.000Z')
  })
})

describe('isThinned', () => {
  it('tells averaged rows from minute samples', () => {
    expect(isThinned(new Date('2026-10-20T13:15:00.000Z'))).toBe(true)
    expect(isThinned(new Date('2026-10-20T13:16:00.210Z'))).toBe(false)
  })
})

describe('thinSamples', () => {
  const at = (iso: string) => new Date(iso)

  it('averages old minutes into 15-min rows and keeps recent ones', async () => {
    const db = await freshDb()
    const { site } = await createAccount(db, 'thin@example.com', 'pw-thin-12345')
    await db.insert(samples).values([
      { siteId: site.id, kind: 'grid', ts: at('2026-09-05T10:01:00Z'), powerW: 100 },
      { siteId: site.id, kind: 'grid', ts: at('2026-09-05T10:07:00Z'), powerW: 300 },
      { siteId: site.id, kind: 'grid', ts: at('2026-12-29T10:01:00Z'), powerW: 500 },
    ])
    // Walks day by day from the oldest minute, at most MAX_DAYS_PER_RUN days a night
    expect(await thinSamples(db, site, now)).toBe(MAX_DAYS_PER_RUN)
    const rows = (await db.select().from(samples).where(eq(samples.siteId, site.id))).sort((a, b) => a.ts.getTime() - b.ts.getTime())
    expect(rows.map((r) => [r.ts.toISOString(), r.powerW])).toEqual([
      ['2026-09-05T10:00:00.000Z', 200],
      ['2026-12-29T10:01:00.000Z', 500],
    ])
  })

  it('sends no Date as a raw parameter, which postgres-js rejects', async () => {
    const db = await freshDb()
    const { site } = await createAccount(db, 'params@example.com', 'pw-params-12345')
    await db.insert(samples).values({ siteId: site.id, kind: 'grid', ts: at('2026-09-05T10:01:00Z'), powerW: 100 })
    const execute = vi.spyOn(db, 'execute')
    await thinSamples(db, site, now)
    expect(execute).toHaveBeenCalled()
    for (const [query] of execute.mock.calls) {
      const { params } = new PgDialect().sqlToQuery(query as SQL)
      expect(params.some((p) => p instanceof Date)).toBe(false)
    }
  })
})
