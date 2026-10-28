import { eq } from 'drizzle-orm'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import {
  createInvite,
  household,
  INVITE_TTL_MS,
  inviteDetails,
  joinHousehold,
  leaveHousehold,
  removeMember,
  revokeInvite,
  signUpWithInvite,
} from '../server/services/household'
import { sessionSite } from '../server/services/members'
import { createAccount } from '../server/services/setup'
import { sha256 } from '../server/utils/crypto'
import { freshDb, migrate, migrationTags, pgliteDb } from './support/pglite'

const rejects = (p: Promise<unknown>, statusCode: number) => expect(p).rejects.toMatchObject({ statusCode })
const membershipOf = async (db: Db, userId: number) => (await db.select().from(schema.siteMembers).where(eq(schema.siteMembers.userId, userId)))[0]
const pushOf = async (db: Db, userId: number) => db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId))
const subscribe = (db: Db, siteId: number, userId: number) =>
  db.insert(schema.pushSubscriptions).values({ siteId, userId, endpoint: `https://push.example/${Math.random()}`, p256dh: 'k', auth: 'a' })

describe('household invitations', () => {
  let db: Db
  let owner: { id: number; email: string }
  let siteId: number
  const invite = async (email: string, now?: Date) => (await createInvite(db, { siteId, invitedBy: owner.id, email }, now)).token

  beforeAll(async () => {
    // Sign-up stays closed (the default): an invitation gets someone in anyway
    db = await freshDb()
    const a = await createAccount(db, 'owner@example.com', 'owner-password')
    owner = a.user
    siteId = a.site.id
  })

  it('lists the open invitation and refuses an address already in the household', async () => {
    await invite(' Partner@Example.com')
    const h = await household(db, siteId)
    expect(h.members).toEqual([expect.objectContaining({ userId: owner.id, role: 'owner' })])
    expect(h.invites).toEqual([expect.objectContaining({ email: 'partner@example.com' })])
    await rejects(invite('owner@example.com'), 400)
    await rejects(invite('not-an-email'), 400)
  })

  it('signs up a new user straight into the household, verified, and they see the owner’s household', async () => {
    const token = await invite('partner@example.com')
    expect(await inviteDetails(db, token)).toEqual({ household: 'Home', inviter: 'owner@example.com', email: 'partner@example.com', account: false })
    const user = await signUpWithInvite(db, { token, password: 'partner-password', locale: 'en', acceptTerms: true })
    expect(user).toMatchObject({ email: 'partner@example.com', locale: 'en' })
    expect(user.emailVerifiedAt).toBeInstanceOf(Date)
    expect(await membershipOf(db, user.id)).toMatchObject({ siteId, role: 'member' })

    await db.insert(schema.sessions).values({ userId: user.id, tokenHash: sha256('partner'), expiresAt: new Date(Date.now() + 86_400_000) })
    const seen = await sessionSite(db, sha256('partner'))
    expect(seen).toMatchObject({ site: { id: siteId }, role: 'member' })

    // The link works once
    await rejects(signUpWithInvite(db, { token, password: 'other-password', acceptTerms: true }), 400)
    expect((await household(db, siteId)).invites).toEqual([])
  })

  it('refuses an expired, revoked or replaced invitation', async () => {
    const expired = await invite('late@example.com', new Date(Date.now() - 2 * INVITE_TTL_MS))
    await rejects(inviteDetails(db, expired), 400)

    const revoked = await invite('revoked@example.com')
    const [row] = (await household(db, siteId)).invites.filter((i) => i.email === 'revoked@example.com')
    await revokeInvite(db, siteId, row!.id)
    await rejects(inviteDetails(db, revoked), 400)
    await rejects(revokeInvite(db, siteId, row!.id), 404)

    const first = await invite('twice@example.com')
    await invite('twice@example.com')
    await rejects(inviteDetails(db, first), 400)
  })

  it('lets an existing user with an empty household join after confirming, which replaces that household', async () => {
    const other = await createAccount(db, 'existing@example.com', 'existing-password')
    const token = await invite('existing@example.com')
    expect((await inviteDetails(db, token)).account).toBe(true)
    await rejects(joinHousehold(db, other.user, token, false), 409)
    await expect(joinHousehold(db, other.user, token, false)).rejects.toMatchObject({ data: { confirm: true } })
    await joinHousehold(db, other.user, token, true)
    expect(await membershipOf(db, other.user.id)).toMatchObject({ siteId, role: 'member' })
    expect(await db.select().from(schema.sites).where(eq(schema.sites.id, other.site.id))).toEqual([])
    await rejects(joinHousehold(db, other.user, token, true), 400)
  })

  it('refuses a user whose own household has connections, and an invitation meant for someone else', async () => {
    const busy = await createAccount(db, 'busy@example.com', 'busy-password')
    await db.insert(schema.integrations).values({ siteId: busy.site.id, provider: 'tibber', credentialsEnc: 'x' })
    const token = await invite('busy@example.com')
    await expect(joinHousehold(db, busy.user, token, true)).rejects.toMatchObject({ statusCode: 409, data: undefined })
    const stranger = await createAccount(db, 'stranger@example.com', 'stranger-password')
    await rejects(joinHousehold(db, stranger.user, token, true), 403)
    expect(await membershipOf(db, busy.user.id)).toMatchObject({ siteId: busy.site.id, role: 'owner' })
  })

  it('refuses signing up for an address that already has an account', async () => {
    const token = await invite('stranger@example.com')
    await rejects(signUpWithInvite(db, { token, password: 'long-enough', acceptTerms: true }), 409)
  })
})

describe('leaving and removing', () => {
  let db: Db
  let ownerId: number
  let siteId: number
  const addMember = async (email: string) => {
    const { token } = await createInvite(db, { siteId, invitedBy: ownerId, email })
    const user = await signUpWithInvite(db, { token, password: 'member-password', acceptTerms: true })
    await subscribe(db, siteId, user.id)
    return user.id
  }

  beforeAll(async () => {
    db = await freshDb()
    const a = await createAccount(db, 'owner@example.com', 'owner-password')
    ownerId = a.user.id
    siteId = a.site.id
    await subscribe(db, siteId, ownerId)
  })

  it('gives a member who leaves a fresh household of their own, without the old notifications', async () => {
    const memberId = await addMember('leaver@example.com')
    const fresh = await leaveHousehold(db, memberId)
    expect(fresh.id).not.toBe(siteId)
    expect(fresh.controlMode).toBe('manual')
    expect(await membershipOf(db, memberId)).toMatchObject({ siteId: fresh.id, role: 'owner' })
    expect(await pushOf(db, memberId)).toEqual([])
    expect(await pushOf(db, ownerId)).toHaveLength(1)
  })

  it('lets the owner remove a member, but not themselves, and the owner can’t leave', async () => {
    const memberId = await addMember('removed@example.com')
    await removeMember(db, siteId, memberId)
    expect((await membershipOf(db, memberId))?.role).toBe('owner')
    expect(await pushOf(db, memberId)).toEqual([])
    await rejects(removeMember(db, siteId, memberId), 404)
    await rejects(removeMember(db, siteId, ownerId), 404)
    await rejects(leaveHousehold(db, ownerId), 400)
    expect((await household(db, siteId)).members.map((m) => m.userId)).toEqual([ownerId])
  })
})

describe('migration 0014', () => {
  it('gives every existing push subscription to the household’s owner', async () => {
    const pg = new PGlite()
    const at = migrationTags.indexOf('0014_household_invites')
    await migrate(pg, migrationTags.slice(0, at))
    await pg.query(`INSERT INTO users (email, password_hash) VALUES ('owner@example.com', 'x')`)
    await pg.query(`INSERT INTO sites (user_id, name, strategy) VALUES (1, 'Home', '{}')`)
    await pg.query(`INSERT INTO site_members (site_id, user_id, role) VALUES (1, 1, 'owner')`)
    await pg.query(`INSERT INTO push_subscriptions (site_id, endpoint, p256dh, auth) VALUES (1, 'https://push.example/1', 'k', 'a')`)
    await migrate(pg, migrationTags.slice(at))
    const [sub] = await pgliteDb(pg).select().from(schema.pushSubscriptions)
    expect(sub!.userId).toBe(1)
  })
})
