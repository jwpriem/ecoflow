import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { listHouseholds, listUsers, recentAudit, updateUser } from '../server/services/admin'
import { createInvite, signUpWithInvite } from '../server/services/household'
import { assertAdmin, sessionSite, touchSession } from '../server/services/members'
import { createAccount } from '../server/services/setup'
import { sha256 } from '../server/utils/crypto'
import { freshDb } from './support/pglite'

const rejects = (p: Promise<unknown>, statusCode: number) => expect(p).rejects.toMatchObject({ statusCode })
const keys = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keys) : v && typeof v === 'object' && !(v instanceof Date) ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []
const SECRET = /password|token|credential|secret|meta|endpoint|p256dh|^auth$/i

describe('admin panel', () => {
  let db: Db
  let adminId: number
  let userId: number
  let memberId: number
  let siteId: number
  const session = async (id: number, token: string) => {
    const [s] = await db.insert(schema.sessions).values({ userId: id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) }).returning()
    return s!
  }

  beforeAll(async () => {
    db = await freshDb()
    adminId = (await createAccount(db, 'admin@example.com', 'admin-password')).user.id
    await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, adminId))
    const u = await createAccount(db, 'someone@example.com', 'user-password', { siteName: 'Someone home' })
    userId = u.user.id
    siteId = u.site.id
    const { token } = await createInvite(db, { siteId, invitedBy: userId, email: 'partner@example.com' })
    memberId = (await signUpWithInvite(db, { token, password: 'member-password', acceptTerms: true })).id
    await db.insert(schema.integrations).values({ siteId, provider: 'tibber', credentialsEnc: 'ENCRYPTED', meta: { homeId: 'h' }, status: 'error', lastError: 'Unauthorized' })
    await db.insert(schema.devices).values({ siteId, serial: 'BK-1', name: 'Stream' })
  })

  it('refuses anyone who is not an admin', () => {
    expect(() => assertAdmin({ role: 'user' })).toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('lists users with household, role and connection health, searchable, without secrets', async () => {
    const all = await listUsers(db)
    expect(all.total).toBe(3)
    const someone = all.users.find((u) => u.id === userId)!
    expect(someone).toMatchObject({ email: 'someone@example.com', household: { id: siteId, name: 'Someone home', role: 'owner' } })
    expect(someone.connections).toEqual([{ provider: 'tibber', status: 'error', lastOkAt: null, lastError: 'Unauthorized' }])
    expect(all.users.find((u) => u.id === memberId)!.household).toMatchObject({ id: siteId, role: 'member' })
    expect(keys(all).filter((k) => SECRET.test(k))).toEqual([])
    expect(JSON.stringify(all)).not.toContain('ENCRYPTED')

    const found = await listUsers(db, 'PARTNER')
    expect(found.users.map((u) => u.id)).toEqual([memberId])
    expect((await listUsers(db, '%')).users).toEqual([])
    expect((await listUsers(db, '', 1)).users).toEqual([])
  })

  it('lists households with members, devices and connections, found by a member’s email', async () => {
    const r = await listHouseholds(db, 'partner@')
    expect(r.households).toHaveLength(1)
    expect(r.households[0]).toMatchObject({
      id: siteId,
      name: 'Someone home',
      members: [{ userId, role: 'owner' }, { userId: memberId, role: 'member' }],
      devices: [{ name: 'Stream', model: 'STREAM Pro' }],
      connections: [{ provider: 'tibber', status: 'error' }],
      lastCollectAt: null,
    })
    expect(keys(r).filter((k) => SECRET.test(k))).toEqual([])
  })

  it('switches experimental and admin, and records who did it', async () => {
    await updateUser(db, adminId, userId, { experimental: true, admin: true })
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId))
    expect(u).toMatchObject({ experimental: true, role: 'admin' })
    await updateUser(db, adminId, userId, { admin: false })
    const log = await recentAudit(db)
    expect(log.map((a) => [a.admin, a.action, a.targetUserId, a.detail])).toEqual([
      ['admin@example.com', 'user.role', userId, { value: 'user' }],
      ['admin@example.com', 'user.role', userId, { value: 'admin' }],
      ['admin@example.com', 'user.experimental', userId, { value: true }],
    ])
  })

  it('can’t take its own admin role or disable itself', async () => {
    await rejects(updateUser(db, adminId, adminId, { admin: false }), 400)
    await rejects(updateUser(db, adminId, adminId, { disabled: true }), 400)
    await rejects(updateUser(db, adminId, 9999, { experimental: true }), 404)
  })

  it('disabling ends the sessions and keeps the user out until enabled again', async () => {
    await session(memberId, 'member-phone')
    await updateUser(db, adminId, memberId, { disabled: true })
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, memberId))).toEqual([])
    // Even a session made some other way doesn't work while disabled
    await session(memberId, 'member-later')
    expect(await sessionSite(db, sha256('member-later'))).toBeNull()
    await updateUser(db, adminId, memberId, { disabled: false })
    expect(await sessionSite(db, sha256('member-later'))).not.toBeNull()
  })

  it('records a session’s use at most every few minutes', async () => {
    const s = await session(userId, 'touch')
    const t0 = new Date()
    touchSession(db, s.id, null, t0)
    await new Promise((r) => setTimeout(r, 50))
    touchSession(db, s.id, t0, new Date(t0.getTime() + 60_000))
    await new Promise((r) => setTimeout(r, 50))
    const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, s.id))
    expect(row!.lastUsedAt?.getTime()).toBe(t0.getTime())
  })
})
