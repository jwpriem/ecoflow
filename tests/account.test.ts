import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { deleteAccount } from '../server/services/account'
import { createInvite, signUpWithInvite } from '../server/services/household'
import { createAccount } from '../server/services/setup'
import { sha256 } from '../server/utils/crypto'
import { freshDb } from './support/pglite'

/** Rows left for the site in every table that has a site_id column. */
async function rowsForSite(db: Db, siteId: number) {
  const tables = (await db.execute(
    sql`SELECT table_name FROM information_schema.columns WHERE column_name = 'site_id' AND table_schema = 'public'`,
  )) as unknown as { rows: { table_name: string }[] }
  const left: Record<string, number> = {}
  for (const { table_name } of tables.rows) {
    const r = (await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table_name)} WHERE site_id = ${siteId}`)) as unknown as { rows: { n: number }[] }
    if (r.rows[0]!.n) left[table_name] = r.rows[0]!.n
  }
  return left
}

describe('deleting an account', () => {
  let db: Db
  let ownerId: number
  let memberId: number
  let siteId: number

  beforeEach(async () => {
    db = await freshDb()
    const a = await createAccount(db, 'owner@example.com', 'owner-password')
    ownerId = a.user.id
    siteId = a.site.id
    const { token } = await createInvite(db, { siteId, invitedBy: ownerId, email: 'member@example.com' })
    memberId = (await signUpWithInvite(db, { token, password: 'member-password', acceptTerms: true })).id
    await createInvite(db, { siteId, invitedBy: ownerId, email: 'pending@example.com' })
    await db.insert(schema.integrations).values({ siteId, provider: 'tibber', credentialsEnc: 'x' })
    const [device] = await db.insert(schema.devices).values({ siteId, serial: 'BK-1', name: 'Stream' }).returning()
    await db.insert(schema.samples).values({ siteId, deviceId: device!.id, ts: new Date(), kind: 'battery', powerW: 100, soc: 50 })
    for (const userId of [ownerId, memberId]) {
      await db.insert(schema.pushSubscriptions).values({ siteId, userId, endpoint: `https://push.example/${userId}`, p256dh: 'k', auth: 'a' })
      await db.insert(schema.sessions).values({ userId, tokenHash: sha256(`s${userId}`), expiresAt: new Date(Date.now() + 86_400_000) })
    }
  })

  it('as the owner removes the household with every row under it; the member keeps an account with an empty household', async () => {
    expect(Object.keys(await rowsForSite(db, siteId)).length).toBeGreaterThan(4)
    const r = await deleteAccount(db, ownerId)
    expect(r).toEqual({ household: { id: siteId, name: 'Home' }, members: [{ id: memberId, email: 'member@example.com', locale: 'nl' }] })

    expect(await rowsForSite(db, siteId)).toEqual({})
    expect(await db.select().from(schema.users).where(eq(schema.users.id, ownerId))).toEqual([])
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, ownerId))).toEqual([])

    const [m] = await db.select().from(schema.siteMembers).where(eq(schema.siteMembers.userId, memberId))
    expect(m).toMatchObject({ role: 'owner' })
    expect(m!.siteId).not.toBe(siteId)
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, memberId))).toHaveLength(1)
  })

  it('as a member removes only that user and leaves the household as it was', async () => {
    const before = await rowsForSite(db, siteId)
    expect(await deleteAccount(db, memberId)).toEqual({ household: null, members: [] })
    expect(await db.select().from(schema.users).where(eq(schema.users.id, memberId))).toEqual([])
    // Only the member's own membership and device subscription are gone
    expect(await rowsForSite(db, siteId)).toEqual({ ...before, site_members: 1, push_subscriptions: 1 })
    const [owner] = await db.select().from(schema.siteMembers).where(eq(schema.siteMembers.userId, ownerId))
    expect(owner).toMatchObject({ siteId, role: 'owner' })
  })
})
