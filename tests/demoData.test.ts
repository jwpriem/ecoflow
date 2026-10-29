import { and, eq, gte, lt, sum } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { DEMO_SYSTEM, demoDay, seededRandom } from '../server/lib/demoSim'
import { defaultStrategy } from '../server/lib/types'
import { liveState } from '../server/services/collector'
import { seedDemo } from '../server/services/demo'
import { demoTick } from '../server/services/demoData'
import { freshDb } from './support/pglite'

const KEY = Buffer.alloc(32, 7).toString('base64')

describe('demo days', () => {
  it('are the same every time for the same date', () => {
    expect(JSON.stringify(demoDay('2026-10-21', defaultStrategy))).toBe(JSON.stringify(demoDay('2026-10-21', defaultStrategy)))
    expect(seededRandom('a')()).toBe(seededRandom('a')())
    expect(seededRandom('a')()).not.toBe(seededRandom('b')())
  })

  it('cover the whole local day, also on the DST change', () => {
    expect(demoDay('2026-10-21', defaultStrategy).points).toHaveLength(288)
    expect(demoDay('2026-10-25', defaultStrategy).points).toHaveLength(300)
    expect(demoDay('2026-10-25', defaultStrategy).prices).toHaveLength(100)
  })

  it('stay within what two STREAM Pro units can do, and add up', () => {
    for (const date of ['2026-01-10', '2026-06-21', '2026-10-21']) {
      for (const p of demoDay(date, defaultStrategy).points) {
        expect(p.soc).toBeGreaterThanOrEqual(0)
        expect(p.soc).toBeLessThanOrEqual(1)
        expect(p.batteryW).toBeLessThanOrEqual(DEMO_SYSTEM.maxChargeW)
        expect(p.batteryW).toBeGreaterThanOrEqual(-DEMO_SYSTEM.maxOutputW)
        expect(p.gridW).toBe(p.loadW - p.solarW + p.batteryW)
        expect(p.solarW).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

// Writing and booking days of readings in PGlite takes seconds, more with the whole suite running alongside
describe('demo generator', { timeout: 60_000 }, () => {
  let db: Db
  let site: typeof schema.sites.$inferSelect
  // 11:02 in Amsterdam, after a run at 11:00
  const now = new Date('2026-10-29T10:02:00Z')

  beforeEach(async () => {
    db = await freshDb()
    const { siteId } = await seedDemo(db, 'pw-demo-123', KEY)
    site = (await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)))[0]!
  })

  it('writes history the real ledger books, with plausible savings for 2 STREAM Pro', async () => {
    const r = await demoTick(db, site, now, 14)
    expect(r.written).toBeGreaterThan(14 * 288 * 4)
    expect(r.booked).toBeGreaterThan(0)

    const rows = await db.select().from(schema.ledger)
    expect(rows.length).toBeGreaterThan(14 * 96)
    for (const l of rows) for (const v of [l.savingOpportunity, l.savingNaive, l.chargedGridKwh, l.dischargedKwh]) expect(Number.isFinite(v)).toBe(true)
    // A week of savings: a few euros, not hundreds
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
    const [week] = await db
      .select({ eur: sum(schema.ledger.savingOpportunity) })
      .from(schema.ledger)
      .where(and(gte(schema.ledger.slotStart, weekAgo), lt(schema.ledger.slotStart, now)))
    expect(Number(week!.eur)).toBeGreaterThan(0.5)
    expect(Number(week!.eur)).toBeLessThan(10)
    expect(await db.select().from(schema.solarLedger)).not.toHaveLength(0)
  })

  it('leaves Home a live view, a plan and today’s prices, and never sends a command', async () => {
    await demoTick(db, site, now, 3)
    const live = liveState(site.id)!
    expect(live.ts).toBe('2026-10-29T10:00:00.000Z')
    expect(live.gridW).not.toBeNull()
    const devs = await db.select().from(schema.devices).where(eq(schema.devices.siteId, site.id))
    for (const d of devs) expect((d.state as { soc?: number }).soc).toBeTypeOf('number')
    const plan = await db.select().from(schema.plans).where(gte(schema.plans.slotStart, now))
    expect(plan.length).toBeGreaterThan(40)
    // 13:00 not reached yet: today's prices only
    const tomorrow = new Date('2026-10-29T23:00:00Z')
    expect(await db.select().from(schema.prices).where(gte(schema.prices.slotStart, tomorrow))).toHaveLength(0)
    expect((await db.select().from(schema.commandsLog)).every((c) => c.result === 'skipped: demo')).toBe(true)
  })

  it('adds only what is new on the next run, tomorrow’s prices after 13:00, and drops what falls out of the window', async () => {
    await demoTick(db, site, now, 3)
    const before = (await db.select().from(schema.samples)).length
    await demoTick(db, site, new Date(now.getTime() + 10 * 60_000), 3)
    expect((await db.select().from(schema.samples)).length - before).toBe(2 * 4)

    const afternoon = new Date('2026-10-29T13:01:00Z')
    await demoTick(db, site, afternoon, 3)
    expect(await db.select().from(schema.prices).where(gte(schema.prices.slotStart, new Date('2026-10-29T23:00:00Z')))).toHaveLength(96)

    const later = new Date(afternoon.getTime() + 2 * 86_400_000)
    await demoTick(db, site, later, 3)
    const oldest = (await db.select().from(schema.samples)).reduce((m, s) => Math.min(m, s.ts.getTime()), Infinity)
    expect(oldest).toBeGreaterThanOrEqual(later.getTime() - 4 * 86_400_000)
    expect(new Set((await db.select().from(schema.samples)).map((s) => `${s.ts.getTime()}:${s.kind}:${s.deviceId}`)).size).toBe(
      (await db.select().from(schema.samples)).length,
    )
  })
})
