import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { assertAdmin, experimentalEnabled, ownerEmail, sessionSite } from '../server/services/members'
import { createAccount } from '../server/services/setup'
import { defaultStrategy } from '../server/lib/types'
import { sha256 } from '../server/utils/crypto'
import { migrate, migrationTags, pgliteDb } from './support/pglite'

async function session(db: Db, userId: number, token: string, expiresAt = new Date(Date.now() + 86_400_000)) {
  await db.insert(schema.sessions).values({ userId, tokenHash: sha256(token), expiresAt })
}

describe('households', () => {
  let db: Db
  let legacy: { userId: number; siteId: number }

  beforeAll(async () => {
    const pg = new PGlite()
    const at = migrationTags.indexOf('0009_site_members')
    // A household from before site_members, to check the backfill.
    await migrate(pg, migrationTags.slice(0, at))
    // Raw SQL: the schema in code already has columns these older tables don't.
    const user = await pg.query<{ id: number }>(`INSERT INTO users (email, password_hash) VALUES ('owner@example.com', 'x') RETURNING id`)
    const site = await pg.query<{ id: number }>(`INSERT INTO sites (user_id, name, strategy) VALUES ($1, 'Home', $2) RETURNING id`, [user.rows[0]!.id, JSON.stringify(defaultStrategy)])
    legacy = { userId: user.rows[0]!.id, siteId: site.rows[0]!.id }
    await migrate(pg, migrationTags.slice(at))
    db = pgliteDb(pg)
  })

  it('makes the first account the admin', async () => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, legacy.userId))
    expect(user?.role).toBe('admin')
    await session(db, legacy.userId, 'token-admin')
    expect(experimentalEnabled((await sessionSite(db, sha256('token-admin')))!.owner)).toBe(true)
  })

  it('gives a member the experimental setting of the household owner', async () => {
    const owner = await createAccount(db, 'tester@example.com', 'password-t')
    expect(owner.user.role).toBe('user')
    expect(owner.user.experimental).toBe(false)
    const [member] = await db.insert(schema.users).values({ email: 'tester-partner@example.com', passwordHash: 'x', experimental: true }).returning()
    await db.insert(schema.siteMembers).values({ siteId: owner.site.id, userId: member!.id, role: 'member' })
    await session(db, member!.id, 'token-tester-partner')
    // The member's own flag doesn't count, only the owner's.
    expect(experimentalEnabled((await sessionSite(db, sha256('token-tester-partner')))!.owner)).toBe(false)
    await db.update(schema.users).set({ experimental: true }).where(eq(schema.users.id, owner.user.id))
    expect(experimentalEnabled((await sessionSite(db, sha256('token-tester-partner')))!.owner)).toBe(true)
  })

  it('makes the creator of an existing site its owner', async () => {
    await session(db, legacy.userId, 'legacy')
    const row = await sessionSite(db, sha256('legacy'))
    expect(row?.site?.id).toBe(legacy.siteId)
    expect(row?.role).toBe('owner')
    expect(await ownerEmail(db, legacy.siteId)).toBe('owner@example.com')
  })

  it('never resolves another user\'s household', async () => {
    const a = await createAccount(db, 'a@example.com', 'password-a', { siteName: 'A' })
    const b = await createAccount(db, 'B@Example.com ', 'password-b', { siteName: 'B' })
    await session(db, a.user.id, 'token-a')
    await session(db, b.user.id, 'token-b')
    expect((await sessionSite(db, sha256('token-a')))?.site?.id).toBe(a.site.id)
    expect((await sessionSite(db, sha256('token-b')))?.site?.id).toBe(b.site.id)
    expect((await sessionSite(db, sha256('token-b')))?.role).toBe('owner')
  })

  it('gives a member the owner\'s household with the member role', async () => {
    const owner = await createAccount(db, 'house@example.com', 'password-o')
    const [member] = await db.insert(schema.users).values({ email: 'partner@example.com', passwordHash: 'x' }).returning()
    await db.insert(schema.siteMembers).values({ siteId: owner.site.id, userId: member!.id, role: 'member' })
    await session(db, member!.id, 'token-member')
    const row = await sessionSite(db, sha256('token-member'))
    expect(row?.site?.id).toBe(owner.site.id)
    expect(row?.role).toBe('member')
    expect(row?.user.email).toBe('partner@example.com')
    expect(await ownerEmail(db, owner.site.id)).toBe('house@example.com')
  })

  it('allows only one household per user', async () => {
    const other = await createAccount(db, 'other@example.com', 'password-x')
    await expect(db.insert(schema.siteMembers).values({ siteId: other.site.id, userId: legacy.userId, role: 'member' })).rejects.toThrow()
  })

  it('returns no household for a user without a membership', async () => {
    const [user] = await db.insert(schema.users).values({ email: 'alone@example.com', passwordHash: 'x' }).returning()
    await session(db, user!.id, 'token-alone')
    const row = await sessionSite(db, sha256('token-alone'))
    expect(row?.user.id).toBe(user!.id)
    expect(row?.site).toBeNull()
    expect(row?.role).toBeNull()
  })

  it('rejects unknown and expired sessions', async () => {
    await session(db, legacy.userId, 'expired', new Date(Date.now() - 1000))
    expect(await sessionSite(db, sha256('expired'))).toBeNull()
    expect(await sessionSite(db, sha256('nope'))).toBeNull()
  })
})

describe('experimentalEnabled', () => {
  it('is on for an owner who switched it on or is an admin, and off otherwise', () => {
    expect(experimentalEnabled({ role: 'user', experimental: false })).toBe(false)
    expect(experimentalEnabled({ role: 'user', experimental: true })).toBe(true)
    expect(experimentalEnabled({ role: 'admin', experimental: false })).toBe(true)
    expect(experimentalEnabled(null)).toBe(false)
  })
})

describe('assertAdmin', () => {
  it('lets an admin through and refuses anyone else with a 403', () => {
    expect(() => assertAdmin({ role: 'admin' })).not.toThrow()
    expect(() => assertAdmin({ role: 'user' })).toThrow(expect.objectContaining({ statusCode: 403 }))
  })
})
