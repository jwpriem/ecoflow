import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { STEERING_VERSION } from '../server/lib/legal'
import { defaultStrategy } from '../server/lib/types'
import { assertSteeringConsent, hasConsent, recordConsent, steeringConsentDue } from '../server/services/consent'
import { createAccount } from '../server/services/setup'
import { currentCommand } from '../server/services/strategy'
import { freshDb, migrate, migrationTags, pgliteDb } from './support/pglite'

type Site = typeof schema.sites.$inferSelect

describe('steering consent', () => {
  let db: Db
  beforeAll(async () => {
    db = await freshDb()
  })

  it('refuses to turn steering on until the current disclaimer is accepted', async () => {
    const { user } = await createAccount(db, 'steer@example.com', 'long-enough', { controlMode: 'manual' })
    await expect(assertSteeringConsent(db, user.id)).rejects.toMatchObject({ statusCode: 409, data: { consent: 'steering', version: STEERING_VERSION } })
    // An older version doesn't count
    await recordConsent(db, user.id, 'steering', '2020-01-01')
    await expect(assertSteeringConsent(db, user.id)).rejects.toMatchObject({ statusCode: 409 })
    await recordConsent(db, user.id, 'steering', STEERING_VERSION)
    await expect(assertSteeringConsent(db, user.id)).resolves.toBeUndefined()
    // Accepting twice is fine
    await recordConsent(db, user.id, 'steering', STEERING_VERSION)
  })

  it('asks the owner of a steered household again only when the version is missing', async () => {
    const { user, site } = await createAccount(db, 'due@example.com', 'long-enough', { controlMode: 'auto' })
    expect(await steeringConsentDue(db, site, user.id, 'owner')).toBe(true)
    expect(await steeringConsentDue(db, site, user.id, 'member')).toBe(false)
    expect(await steeringConsentDue(db, { ...site, controlMode: 'manual' }, user.id, 'owner')).toBe(false)
    await recordConsent(db, user.id, 'steering', STEERING_VERSION)
    expect(await steeringConsentDue(db, site, user.id, 'owner')).toBe(false)
  })
})

describe('monitor only', () => {
  const site = (over: Partial<Site>) => ({ id: 1, controlMode: 'manual', override: null, ...over }) as Site
  const now = new Date('2027-02-01T12:05:00Z')
  const plan = [{ slotStart: new Date('2027-02-01T12:00:00Z'), action: 'discharge' as const, targetW: 800, price: 0.3, reason: '' }]

  it('sends nothing, not even an override', () => {
    const override = { mode: 'charge_grid' as const, until: new Date(now.getTime() + 3_600_000).toISOString() }
    expect(currentCommand(site({ override }), plan as never, now, false)).toEqual({ mode: 'self_use', source: 'manual' })
    expect(currentCommand(site({ controlMode: 'auto', override }), plan as never, now, false).source).toBe('override')
    expect(currentCommand(site({ controlMode: 'auto' }), plan as never, now, false).source).toBe('plan')
  })
})

describe('migration 0019', () => {
  it('counts the owners of households WattsWise already steers as having accepted', async () => {
    const pg = new PGlite()
    const at = migrationTags.indexOf('0019_steering_consent')
    await migrate(pg, migrationTags.slice(0, at))
    const user = async (email: string) => (await pg.query<{ id: number }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [email])).rows[0]!.id
    const household = async (owner: number, mode: string, member?: number) => {
      const s = (await pg.query<{ id: number }>(`INSERT INTO sites (user_id, name, strategy, control_mode) VALUES ($1, 'Home', $2, $3) RETURNING id`, [owner, JSON.stringify(defaultStrategy), mode])).rows[0]!.id
      await pg.query(`INSERT INTO site_members (site_id, user_id, role) VALUES ($1, $2, 'owner')`, [s, owner])
      if (member) await pg.query(`INSERT INTO site_members (site_id, user_id, role) VALUES ($1, $2, 'member')`, [s, member])
    }
    const steered = await user('steered@example.com')
    const member = await user('member@example.com')
    const monitored = await user('monitor@example.com')
    await household(steered, 'auto', member)
    await household(monitored, 'manual')
    await migrate(pg, migrationTags.slice(at))
    const db = pgliteDb(pg)
    expect(await hasConsent(db, steered, 'steering', STEERING_VERSION)).toBe(true)
    expect(await hasConsent(db, member, 'steering', STEERING_VERSION)).toBe(false)
    expect(await hasConsent(db, monitored, 'steering', STEERING_VERSION)).toBe(false)
    expect(await db.select().from(schema.consents).where(eq(schema.consents.kind, 'steering'))).toHaveLength(1)
  })
})
