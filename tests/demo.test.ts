import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { STEERING_VERSION, TERMS_VERSION } from '../server/lib/legal'
import { hasConsent } from '../server/services/consent'
import { DEMO_EMAIL, seedDemo } from '../server/services/demo'
import { JOB_OPTIONS, jobSites } from '../server/services/jobs'
import { assertNotDemo } from '../server/services/members'
import { createAccount } from '../server/services/setup'
import { runStrategy } from '../server/services/strategy'
import { verifyPassword } from '../server/utils/crypto'
import { freshDb } from './support/pglite'

const KEY = Buffer.alloc(32, 7).toString('base64')
let db: Db

beforeEach(async () => {
  db = await freshDb()
})

describe('demo seed', () => {
  it('creates the demo household with fake connections and two STREAM Pro units', async () => {
    const { userId, siteId } = await seedDemo(db, 'first-password', KEY)
    const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId))
    expect(site).toMatchObject({ isDemo: true, onboarding: null, controlMode: 'auto' })
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId))
    expect(user).toMatchObject({ email: DEMO_EMAIL, role: 'user', experimental: false })
    expect(user!.emailVerifiedAt).not.toBeNull()
    const conns = await db.select().from(schema.integrations).where(eq(schema.integrations.siteId, siteId))
    expect(conns.map((c) => c.provider).sort()).toEqual(['ecoflow_official', 'solaredge', 'tibber'])
    const devs = await db.select().from(schema.devices).where(eq(schema.devices.siteId, siteId))
    expect(devs.map((d) => d.model)).toEqual(['STREAM Pro', 'STREAM Pro'])
    expect(await hasConsent(db, userId, 'terms', TERMS_VERSION)).toBe(true)
    expect(await hasConsent(db, userId, 'steering', STEERING_VERSION)).toBe(true)
  })

  it('is idempotent, and takes a new password', async () => {
    const first = await seedDemo(db, 'first-password', KEY)
    await db.update(schema.users).set({ experimental: true, role: 'admin' }).where(eq(schema.users.id, first.userId))
    const again = await seedDemo(db, 'second-password', KEY)
    expect(again).toEqual(first)
    expect(await db.select().from(schema.users)).toHaveLength(1)
    expect(await db.select().from(schema.sites)).toHaveLength(1)
    expect(await db.select().from(schema.integrations)).toHaveLength(3)
    expect(await db.select().from(schema.devices)).toHaveLength(2)
    expect(await db.select().from(schema.consents)).toHaveLength(2)
    const [user] = await db.select().from(schema.users)
    expect(user).toMatchObject({ role: 'user', experimental: false })
    expect(await verifyPassword('second-password', user!.passwordHash)).toBe(true)
  })
})

describe('demo is read-only', () => {
  const demo = { isDemo: true }

  it('refuses every change with a 403', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/api/strategy', '/api/integrations/tibber', '/api/account', '/api/auth/password', '/api/auth/logout-all']) {
        expect(() => assertNotDemo(demo, method, path)).toThrow(expect.objectContaining({ statusCode: 403, statusMessage: 'This is a demo: changes are not saved' }))
      }
    }
  })

  it('refuses a read that stores something', () => {
    expect(() => assertNotDemo(demo, 'GET', '/api/integrations/solaredge/authorize?x=1')).toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('allows reading and logging out', () => {
    expect(() => assertNotDemo(demo, 'GET', '/api/dashboard')).not.toThrow()
    expect(() => assertNotDemo(demo, 'POST', '/api/auth/logout')).not.toThrow()
  })

  it('leaves every other household alone', () => {
    expect(() => assertNotDemo({ isDemo: false }, 'DELETE', '/api/account')).not.toThrow()
    expect(() => assertNotDemo(null, 'POST', '/api/strategy')).not.toThrow()
  })
})

describe('jobs and the demo household', () => {
  it('skips it in every job that talks to a provider; only retention and the demo generator work on it', async () => {
    const { siteId: demoId } = await seedDemo(db, 'pw-demo-123', KEY)
    const { site: real } = await createAccount(db, 'real@example.com', 'pw-real-123')
    await db.insert(schema.integrations).values({ siteId: real.id, provider: 'tibber', credentialsEnc: 'x' })
    for (const [job, opts] of Object.entries(JOB_OPTIONS)) {
      const ids = (await jobSites(db, opts.skipEmpty, opts.demo)).map((s) => s.id)
      expect(ids.includes(demoId), job).toBe(job === 'retention' || job === 'demo')
      expect(ids.includes(real.id), job).toBe(job !== 'demo')
    }
    // The startup sweep (EcoFlow, Pulse, prices, Zeekr, strategy) uses the default
    expect((await jobSites(db, true)).map((s) => s.id)).toEqual([real.id])
  })

  it('never sends a command for it', async () => {
    const { siteId } = await seedDemo(db, 'pw-demo-123', KEY)
    const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId))
    let sent = 0
    await runStrategy(db, site!, new Date(), async () => {
      sent++
      return 'ok'
    })
    expect(sent).toBe(0)
    const log = await db.select().from(schema.commandsLog)
    expect(log.length).toBeGreaterThan(0)
    expect(log.every((l) => l.result === 'skipped: demo')).toBe(true)
  })
})
