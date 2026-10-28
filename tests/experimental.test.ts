import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { assertExperimental, experimentalSite, visibleProviders } from '../server/services/experimental'
import { createAccount } from '../server/services/setup'
import { freshDb } from './support/pglite'

const ALL: schema.Provider[] = ['tibber', 'solaredge', 'ecoflow_official', 'zeekr', 'tibber_app']

describe('visibleProviders', () => {
  it('leaves Zeekr and the Tibber app out for a household without experimental', () => {
    expect(visibleProviders(ALL, false)).toEqual(['tibber', 'solaredge', 'ecoflow_official'])
  })

  it('lists everything for an experimental household', () => {
    expect(visibleProviders(ALL, true)).toEqual(ALL)
  })
})

describe('assertExperimental', () => {
  const forbidden = expect.objectContaining({ statusCode: 403 })

  it('refuses the experimental providers and the cars without experimental', () => {
    expect(() => assertExperimental(false, 'zeekr')).toThrow(forbidden)
    expect(() => assertExperimental(false, 'tibber_app')).toThrow(forbidden)
    expect(() => assertExperimental(false)).toThrow(forbidden)
  })

  it('lets the public providers through either way', () => {
    for (const p of ['tibber', 'solaredge', 'ecoflow_official'] as const) {
      expect(() => assertExperimental(false, p)).not.toThrow()
      expect(() => assertExperimental(true, p)).not.toThrow()
    }
  })

  it('lets everything through for an experimental household', () => {
    expect(() => assertExperimental(true, 'zeekr')).not.toThrow()
    expect(() => assertExperimental(true)).not.toThrow()
  })
})

describe('experimentalSite', () => {
  let db: Db
  beforeAll(async () => {
    db = await freshDb()
  })

  it('is on for an admin owner, as for the owner\'s own household', async () => {
    const { user, site } = await createAccount(db, 'admin@example.com', 'password-a')
    await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, user.id))
    expect(await experimentalSite(db, site.id)).toBe(true)
  })

  it('is off for a new household and on once its owner switches it on', async () => {
    const { user, site } = await createAccount(db, 'public@example.com', 'password-p')
    expect(await experimentalSite(db, site.id)).toBe(false)
    await db.update(schema.users).set({ experimental: true }).where(eq(schema.users.id, user.id))
    expect(await experimentalSite(db, site.id)).toBe(true)
  })

  it('ignores a member\'s own flag', async () => {
    const { site } = await createAccount(db, 'owner@example.com', 'password-o')
    const [member] = await db.insert(schema.users).values({ email: 'member@example.com', passwordHash: 'x', role: 'admin', experimental: true }).returning()
    await db.insert(schema.siteMembers).values({ siteId: site.id, userId: member!.id, role: 'member' })
    expect(await experimentalSite(db, site.id)).toBe(false)
  })

  it('is off for a site without an owner', async () => {
    expect(await experimentalSite(db, 999_999)).toBe(false)
  })
})
