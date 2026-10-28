import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { fallbackFeedIn, feedInPrice, nettingEnd } from '../server/lib/feedin'
import { defaultStrategy } from '../server/lib/types'
import { runLedger } from '../server/services/ledger'
import { recomputeFeedIn } from '../server/services/prices'
import { createAccount } from '../server/services/setup'
import { freshDb } from './support/pglite'

const terms = { nettingUntil: '2027-01-01', factor: 0.5, feeEur: 0.02 }
// Midnight in the Netherlands is 23:00 UTC in winter
const lastNetted = new Date('2026-12-31T22:45:00Z')
const firstAfter = new Date('2026-12-31T23:00:00Z')

describe('feed-in price', () => {
  it('is the full price until local midnight on the netting date, then spot × factor − fee', () => {
    expect(nettingEnd(terms, 'Europe/Amsterdam')).toEqual(firstAfter)
    expect(feedInPrice(lastNetted, 0.1, 0.3, terms)).toBe(0.3)
    expect(feedInPrice(firstAfter, 0.1, 0.3, terms)).toBeCloseTo(0.03)
    // A negative spot price stays negative
    expect(feedInPrice(firstAfter, -0.04, 0.1, terms)).toBeCloseTo(-0.04)
  })

  it('starts new households on Tibber’s terms: the spot price minus 1.8 ct', () => {
    expect(defaultStrategy.feedIn).toEqual({ nettingUntil: '2027-01-01', factor: 1, feeEur: 0.018 })
    expect(feedInPrice(firstAfter, 0.1, 0.3, defaultStrategy.feedIn)).toBeCloseTo(0.082)
  })

  it('uses the total for a slot without a price', () => {
    expect(fallbackFeedIn(lastNetted, 0.25, terms)).toBe(0.25)
    expect(fallbackFeedIn(firstAfter, 0.25, terms)).toBeCloseTo(0.105)
  })
})

describe('the household’s terms in the stored prices and the ledger', () => {
  let db: Db
  let site: typeof schema.sites.$inferSelect
  const slots = [lastNetted, firstAfter, new Date(firstAfter.getTime() + 900_000)]

  beforeEach(async () => {
    db = await freshDb()
    const a = await createAccount(db, 'owner@example.com', 'owner-password')
    ;[site] = await db.update(schema.sites).set({ strategy: { ...defaultStrategy, feedIn: terms } }).where(eq(schema.sites.id, a.site.id)).returning()
    // Prices for the first two slots only, stored under the old (default) terms
    await db.insert(schema.prices).values(
      slots.slice(0, 2).map((slotStart) => ({ siteId: site.id, slotStart, energy: 0.1, tax: 0.2, total: 0.3, feedIn: feedInPrice(slotStart, 0.1, 0.3, defaultStrategy.feedIn), source: 'tibber' as const })),
    )
  })

  it('works the stored feed-in out again from a date on, leaving earlier slots alone', async () => {
    expect(await recomputeFeedIn(db, site, firstAfter)).toBe(1)
    const rows = await db.select().from(schema.prices).orderBy(schema.prices.slotStart)
    expect(rows.map((r) => r.feedIn)).toEqual([0.3, 0.1 * 0.5 - 0.02])
  })

  it('values stored solar by the household’s terms across the switch', async () => {
    await recomputeFeedIn(db, site, lastNetted)
    const [dev] = await db.insert(schema.devices).values({ siteId: site.id, serial: 'BK-1', name: 'Stream' }).returning()
    // Each slot: 15 minutes charging 1000 W from solar while still exporting 200 W
    const rows = slots.flatMap((s) =>
      Array.from({ length: 15 }, (_, i) => new Date(s.getTime() + i * 60_000)).flatMap((ts) => [
        { siteId: site.id, ts, kind: 'grid' as const, powerW: -200 },
        { siteId: site.id, deviceId: dev!.id, ts, kind: 'battery' as const, powerW: 1000, soc: 0.5 },
      ]),
    )
    await db.insert(schema.samples).values(rows)
    await runLedger(db, site, new Date(slots[2]!.getTime() + 900_000))
    const booked = await db.select().from(schema.ledger).orderBy(schema.ledger.slotStart)
    expect(booked.map((b) => b.priceFeedIn)).toEqual([0.3, expect.closeTo(0.03), expect.closeTo(0.105)])
    expect(booked.map((b) => b.costOpportunity)).toEqual([expect.closeTo(0.25 * 0.3), expect.closeTo(0.25 * 0.03), expect.closeTo(0.25 * 0.105)])
  })
})
