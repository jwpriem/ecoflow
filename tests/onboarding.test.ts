import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { defaultStrategy } from '../server/lib/types'
import { saveIntegration } from '../server/services/integrations'
import { moveOnboarding } from '../server/services/onboarding'
import { createAccount } from '../server/services/setup'
import { freshDb, migrate, migrationTags, pgliteDb } from './support/pglite'

const KEY = Buffer.alloc(32, 7).toString('base64')
const rejects = (p: Promise<unknown>, statusCode: number, statusMessage?: string) =>
  expect(p).rejects.toMatchObject({ statusCode, ...(statusMessage ? { statusMessage } : {}) })

describe('onboarding', () => {
  let db: Db
  let site: typeof schema.sites.$inferSelect
  beforeAll(async () => {
    db = await freshDb()
    site = (await createAccount(db, 'new@example.com', 'long-enough', { controlMode: 'manual' })).site
  })
  const tibber = async (status: 'ok' | 'error', realtime: boolean) => {
    await saveIntegration(db, site.id, 'tibber', { token: 't' }, { realtime }, KEY)
    await db.update(schema.integrations).set({ status }).where(eq(schema.integrations.siteId, site.id))
  }

  it('starts a new household at the first step', () => {
    expect(site.onboarding).toBe('household')
  })

  it('goes forward one step at a time', async () => {
    await rejects(moveOnboarding(db, site, 'ecoflow'), 409, 'Finish the steps in order')
    site = await moveOnboarding(db, site, 'tibber')
    expect(site.onboarding).toBe('tibber')
  })

  it('needs Tibber with a Pulse before the batteries', async () => {
    await rejects(moveOnboarding(db, site, 'ecoflow'), 409, 'Connect Tibber first')
    await tibber('ok', false)
    await rejects(moveOnboarding(db, site, 'ecoflow'), 409, 'WattsWise needs a Tibber Pulse')
    await tibber('ok', true)
    site = await moveOnboarding(db, site, 'ecoflow')
  })

  it('needs a battery before SolarEdge, which can be skipped', async () => {
    await rejects(moveOnboarding(db, site, 'solaredge'), 409, 'Connect your EcoFlow batteries first')
    await db.insert(schema.devices).values({ siteId: site.id, serial: 'BK11', name: 'Stream' })
    site = await moveOnboarding(db, site, 'solaredge')
    site = await moveOnboarding(db, site, 'battery')
  })

  it('can always go back, and is done after the last step', async () => {
    site = await moveOnboarding(db, site, 'household')
    for (const s of ['tibber', 'ecoflow', 'solaredge', 'battery', 'control'] as const) site = await moveOnboarding(db, site, s)
    site = await moveOnboarding(db, site, 'done')
    expect(site.onboarding).toBeNull()
    await rejects(moveOnboarding(db, site, 'household'), 409)
  })
})

describe('migration 0020', () => {
  it('counts every household from before onboarding as set up', async () => {
    const pg = new PGlite()
    const at = migrationTags.indexOf('0020_onboarding')
    await migrate(pg, migrationTags.slice(0, at))
    const u = await pg.query<{ id: number }>(`INSERT INTO users (email, password_hash) VALUES ('old@example.com', 'x') RETURNING id`)
    await pg.query(`INSERT INTO sites (user_id, name, strategy) VALUES ($1, 'Home', $2)`, [u.rows[0]!.id, JSON.stringify(defaultStrategy)])
    await migrate(pg, migrationTags.slice(at))
    const [old] = await pgliteDb(pg).select().from(schema.sites)
    expect(old!.onboarding).toBeNull()
  })
})
