import { eq } from 'drizzle-orm'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { batteryModel, derivedMaxOutputW } from '../server/lib/batteryModels'
import { buildPlan } from '../server/lib/strategy'
import { defaultStrategy, type StrategyConfig } from '../server/lib/types'
import { refreshTypicalLoad, typicalLoadW } from '../server/services/load'
import { createAccount } from '../server/services/setup'
import { effectiveStrategy } from '../server/services/strategy'
import { freshDb, migrate, migrationTags, pgliteDb } from './support/pglite'

const pro = (maxDischargeW = 800) => ({ model: 'STREAM Pro', maxDischargeW, maxChargeW: 1200, capacityWh: 1920 })

describe('battery models', () => {
  it('fills in a STREAM unit, also for a model name it does not know', () => {
    expect(batteryModel('STREAM Ultra')).toEqual({ capacityWh: 1920, maxChargeW: 1200, maxDischargeW: 800, systemOutputW: 800 })
    expect(batteryModel('Something new')).toEqual(batteryModel('STREAM Pro'))
  })

  it('derives the output limit from the devices, capped by the system', () => {
    expect(derivedMaxOutputW([pro()], 800)).toBe(800)
    expect(derivedMaxOutputW([pro(), pro()], 800)).toBe(800)
    expect(derivedMaxOutputW([pro(), pro(), pro()], 800)).toBe(800)
    expect(derivedMaxOutputW([pro(300)], 800)).toBe(300)
    expect(derivedMaxOutputW([pro(300), pro(300)], 800)).toBe(600)
    expect(derivedMaxOutputW([], 800)).toBe(800)
  })

  it('uses the derived limit only when it is on auto', () => {
    const own = { strategy: { ...defaultStrategy, maxOutputAuto: false, maxOutputW: 650 } }
    expect(effectiveStrategy(own, [pro(300)]).maxOutputW).toBe(650)
    expect(effectiveStrategy({ strategy: { ...defaultStrategy, maxOutputW: 650 } }, [pro(300)]).maxOutputW).toBe(300)
  })
})

describe('the plan with derived values', () => {
  const base = new Date('2027-02-01T00:00:00Z')
  // A night of cheap prices, then an expensive evening: what the batteries are for
  const totals = [...Array(24).fill(0.12), ...Array(24).fill(0.22), ...Array(24).fill(0.42), ...Array(24).fill(0.24)]
  const prices = totals.map((total, i) => ({ slotStart: new Date(base.getTime() + i * 900_000), total, energy: total / 2, feedIn: total / 2 }))
  const plan = (devs: ReturnType<typeof pro>[], cfg: StrategyConfig) =>
    buildPlan({
      prices,
      storedKwh: 0,
      capacityKwh: devs.reduce((s, d) => s + d.capacityWh, 0) / 1000,
      maxChargeW: devs.reduce((s, d) => s + d.maxChargeW, 0),
      maxDischargeW: devs.reduce((s, d) => s + d.maxDischargeW, 0),
      poolAvgCost: 0,
      cfg,
      timeZone: 'UTC',
    })
  const count = (p: ReturnType<typeof plan>, action: string) => p.filter((s) => s.action === action).length

  it('gives the owner’s 2× STREAM Pro the same plan as before', () => {
    const before = { ...defaultStrategy, avgLoadW: 450, maxOutputW: 800 }
    // The owner's household after migration 0018: both values still by hand
    const kept = effectiveStrategy({ strategy: { ...before, avgLoadAuto: false, maxOutputAuto: false } }, [pro(), pro()])
    // And with the output limit on auto it still comes out at 800 W
    const auto = effectiveStrategy({ strategy: { ...before, avgLoadAuto: false, maxOutputAuto: true } }, [pro(), pro()])
    expect(plan([pro(), pro()], kept)).toEqual(plan([pro(), pro()], before))
    expect(plan([pro(), pro()], auto)).toEqual(plan([pro(), pro()], before))
  })

  it('scales with 1 and 3 units: more storage, more expensive slots covered', () => {
    const cfg = (devs: ReturnType<typeof pro>[]) => effectiveStrategy({ strategy: { ...defaultStrategy, avgLoadW: 450 } }, devs)
    const [one, two, three] = [[pro()], [pro(), pro()], [pro(), pro(), pro()]].map((d) => plan(d, cfg(d)))
    expect(count(one!, 'discharge')).toBeGreaterThan(0)
    expect(count(one!, 'discharge')).toBeLessThan(count(two!, 'discharge'))
    expect(count(two!, 'discharge')).toBeLessThanOrEqual(count(three!, 'discharge'))
    // Charging from the grid takes fewer slots with more units charging at once
    expect(count(three!, 'charge_grid')).toBeLessThanOrEqual(count(one!, 'charge_grid') * 3)
  })
})

describe('typical load', () => {
  let db: Db
  let site: typeof schema.sites.$inferSelect
  let deviceId: number
  const now = new Date('2026-10-28T12:00:00Z')

  /** Minute readings: the Pulse's grid power and the battery's own power (positive = charging). */
  const readings = async (minutes: number, gridW: (i: number) => number, batteryW: (i: number) => number, skip = 0) => {
    const rows = []
    for (let i = skip + 1; i <= skip + minutes; i++) {
      const ts = new Date(now.getTime() - i * 60_000)
      rows.push({ siteId: site.id, ts, kind: 'grid' as const, powerW: gridW(i) })
      rows.push({ siteId: site.id, deviceId, ts, kind: 'battery' as const, powerW: batteryW(i) })
    }
    for (let i = 0; i < rows.length; i += 1000) await db.insert(schema.samples).values(rows.slice(i, i + 1000))
  }

  beforeEach(async () => {
    db = await freshDb()
    site = (await createAccount(db, 'owner@example.com', 'owner-password')).site
    deviceId = (await db.insert(schema.devices).values({ siteId: site.id, serial: 'BK-1', name: 'Stream' }).returning())[0]!.id
  })

  it('is the house’s draw without the batteries, with export counted as zero', async () => {
    // Half the minutes: 700 W from the grid while charging 200 W (house 500 W).
    // The other half: 100 W from the grid while discharging 300 W (house 400 W), and some export (counts 0).
    await readings(2000, (i) => (i % 2 ? 700 : i % 10 === 0 ? -500 : 100), (i) => (i % 2 ? 200 : -300))
    // 1000 × 500 + 800 × 400 + 200 × 0 over 2000 minutes = 410 W
    expect(await typicalLoadW(db, site.id, now)).toBe(410)
  })

  it('needs a day of readings, and only stores it for a household on auto', async () => {
    await readings(600, () => 900, () => 0)
    expect(await typicalLoadW(db, site.id, now)).toBeNull()
    // Not enough history: auto falls back to the default
    expect(await refreshTypicalLoad(db, site, now)).toBe(defaultStrategy.avgLoadW)

    await readings(2000, () => 900, () => 0, 600)
    const manual = { ...site, strategy: { ...defaultStrategy, avgLoadAuto: false, avgLoadW: 333 } }
    expect(await refreshTypicalLoad(db, manual, now)).toBe(333)
    expect(await refreshTypicalLoad(db, site, now)).toBe(900)
    const [stored] = await db.select().from(schema.sites).where(eq(schema.sites.id, site.id))
    expect(stored!.strategy.avgLoadW).toBe(900)
  })
})

describe('migration 0018', () => {
  it('keeps an existing household on its own values', async () => {
    const pg = new PGlite()
    const at = migrationTags.indexOf('0018_strategy_auto')
    await migrate(pg, migrationTags.slice(0, at))
    await pg.query(`INSERT INTO users (email, password_hash) VALUES ('owner@example.com', 'x')`)
    await pg.query(`INSERT INTO sites (user_id, name, strategy) VALUES (1, 'Home', '{"avgLoadW": 520, "maxOutputW": 800}')`)
    await migrate(pg, migrationTags.slice(at))
    const [s] = await pgliteDb(pg).select().from(schema.sites)
    expect(s!.strategy).toEqual({ avgLoadW: 520, maxOutputW: 800, avgLoadAuto: false, maxOutputAuto: false })
  })
})
