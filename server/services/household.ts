import { and, count, eq, gt, isNull, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { createError } from 'h3'
import type { Db } from '../db/client'
import { consents, householdInvites, integrations, pushSubscriptions, siteMembers, sites, users } from '../db/schema'
import { TERMS_VERSION } from '../lib/legal'
import { type Locale, LOCALES } from '../lib/types'
import { hashPassword, newToken, sha256 } from '../utils/crypto'
import { EMAIL, newHousehold, normalizeEmail, type Tx } from './setup'

export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000
/** Plenty for a family, and one account can't keep mailing strangers */
const MAX_PENDING = 10

const inviter = alias(users, 'inviter')
const gone = () => createError({ statusCode: 400, statusMessage: 'This invitation has expired or was already used' })

/** The members (owner first) and the invitations still open. */
export async function household(db: Db, siteId: number, now = new Date()) {
  const members = await db
    .select({ userId: users.id, email: users.email, role: siteMembers.role })
    .from(siteMembers)
    .innerJoin(users, eq(users.id, siteMembers.userId))
    .where(eq(siteMembers.siteId, siteId))
    .orderBy(siteMembers.createdAt)
  const invites = await db
    .select({ id: householdInvites.id, email: householdInvites.email, expiresAt: householdInvites.expiresAt })
    .from(householdInvites)
    .where(and(eq(householdInvites.siteId, siteId), isNull(householdInvites.acceptedAt), gt(householdInvites.expiresAt, now)))
    .orderBy(householdInvites.createdAt)
  members.sort((a, b) => (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1))
  return { members, invites }
}

/** A new invitation for the address; an earlier open one to the same address stops working. The token goes in the email only. */
export async function createInvite(db: Db, input: { siteId: number; invitedBy: number; email: unknown }, now = new Date()) {
  const email = normalizeEmail(String(input.email ?? ''))
  if (!EMAIL.test(email)) throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address' })
  const [member] = await db
    .select({ id: users.id })
    .from(siteMembers)
    .innerJoin(users, eq(users.id, siteMembers.userId))
    .where(and(eq(siteMembers.siteId, input.siteId), eq(users.email, email)))
  if (member) throw createError({ statusCode: 400, statusMessage: 'This address is already in your household' })
  const open = and(eq(householdInvites.siteId, input.siteId), isNull(householdInvites.acceptedAt))
  const [pending] = await db
    .select({ n: count() })
    .from(householdInvites)
    .where(and(open, gt(householdInvites.expiresAt, now), ne(householdInvites.email, email)))
  if (pending!.n >= MAX_PENDING) throw createError({ statusCode: 400, statusMessage: 'Too many open invitations: revoke one first' })

  const token = newToken()
  const invite = await db.transaction(async (tx) => {
    await tx.delete(householdInvites).where(and(open, eq(householdInvites.email, email)))
    const [row] = await tx
      .insert(householdInvites)
      .values({ siteId: input.siteId, email, tokenHash: sha256(token), invitedBy: input.invitedBy, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) })
      .returning({ id: householdInvites.id, email: householdInvites.email, expiresAt: householdInvites.expiresAt })
    return row!
  })
  return { invite, token }
}

export async function revokeInvite(db: Db, siteId: number, id: number) {
  const rows = await db
    .delete(householdInvites)
    .where(and(eq(householdInvites.id, id), eq(householdInvites.siteId, siteId), isNull(householdInvites.acceptedAt)))
    .returning({ id: householdInvites.id })
  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
}

async function pendingInvite(db: Tx, token: string, now: Date) {
  if (!token) return null
  const [row] = await db
    .select({ id: householdInvites.id, siteId: householdInvites.siteId, email: householdInvites.email, household: sites.name, inviter: inviter.email })
    .from(householdInvites)
    .innerJoin(sites, eq(sites.id, householdInvites.siteId))
    .innerJoin(inviter, eq(inviter.id, householdInvites.invitedBy))
    .where(and(eq(householdInvites.tokenHash, sha256(token)), isNull(householdInvites.acceptedAt), gt(householdInvites.expiresAt, now)))
  return row ?? null
}

/** Uses up the invitation in one statement, so the same link can't be accepted twice. */
async function consume(tx: Tx, id: number, now: Date) {
  const rows = await tx
    .update(householdInvites)
    .set({ acceptedAt: now })
    .where(and(eq(householdInvites.id, id), isNull(householdInvites.acceptedAt), gt(householdInvites.expiresAt, now)))
    .returning({ id: householdInvites.id })
  if (!rows.length) throw gone()
}

/** What the invitation page shows. `account` says whether to offer logging in or signing up: only the link's holder learns it. */
export async function inviteDetails(db: Db, token: string, now = new Date()) {
  const invite = await pendingInvite(db, token, now)
  if (!invite) throw gone()
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, invite.email))
  return { household: invite.household, inviter: invite.inviter, email: invite.email, account: !!user }
}

/**
 * The logged-in user joins as a member. Their own household is replaced (only when it is empty and they confirm),
 * or, for a member elsewhere, left. Throws a 409 with `data.confirm` until `confirm` is true.
 */
export async function joinHousehold(db: Db, user: { id: number; email: string }, token: string, confirm: boolean, now = new Date()) {
  return db.transaction(async (tx) => {
    const invite = await pendingInvite(tx, token, now)
    if (!invite) throw gone()
    if (normalizeEmail(user.email) !== invite.email) throw createError({ statusCode: 403, statusMessage: 'This invitation is for another email address' })
    const [current] = await tx.select().from(siteMembers).where(eq(siteMembers.userId, user.id))
    if (current?.siteId === invite.siteId) throw createError({ statusCode: 400, statusMessage: 'You are already in this household' })
    if (current?.role === 'owner') {
      const [others] = await tx
        .select({ n: count() })
        .from(siteMembers)
        .where(and(eq(siteMembers.siteId, current.siteId), ne(siteMembers.userId, user.id)))
      if (others!.n) throw createError({ statusCode: 409, statusMessage: 'Your household has other members: remove them first' })
      const [conns] = await tx.select({ n: count() }).from(integrations).where(eq(integrations.siteId, current.siteId))
      if (conns!.n) throw createError({ statusCode: 409, statusMessage: 'Your own household still has connections: remove them first' })
    }
    if (current && !confirm) {
      throw createError({
        statusCode: 409,
        statusMessage: current.role === 'owner' ? 'Joining replaces your own household' : 'Joining means leaving your current household',
        data: { confirm: true },
      })
    }
    await consume(tx, invite.id, now)
    if (current?.role === 'owner') await tx.delete(sites).where(eq(sites.id, current.siteId))
    else if (current) await tx.delete(siteMembers).where(eq(siteMembers.userId, user.id))
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id))
    await tx.insert(siteMembers).values({ siteId: invite.siteId, userId: user.id, role: 'member' })
    // The link arrived at this address, so it is verified too
    await tx.update(users).set({ emailVerifiedAt: now }).where(and(eq(users.id, user.id), isNull(users.emailVerifiedAt)))
    return invite.siteId
  })
}

export interface InviteSignupInput {
  token?: unknown
  password?: unknown
  locale?: unknown
  acceptTerms?: unknown
}

/**
 * A new account straight into the household, also while sign-up is closed: the invitation is the way in.
 * The email is the invited address, verified by the link itself.
 */
export async function signUpWithInvite(db: Db, input: InviteSignupInput, now = new Date()) {
  const password = typeof input.password === 'string' ? input.password : ''
  const locale: Locale = LOCALES.includes(input.locale as Locale) ? (input.locale as Locale) : 'nl'
  if (password.length < 8) throw createError({ statusCode: 400, statusMessage: 'Choose a password of at least 8 characters' })
  if (input.acceptTerms !== true) throw createError({ statusCode: 400, statusMessage: 'Accept the terms to create an account' })
  const passwordHash = await hashPassword(password)
  return db.transaction(async (tx) => {
    const invite = await pendingInvite(tx, String(input.token ?? ''), now)
    if (!invite) throw gone()
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, invite.email))
    if (existing) throw createError({ statusCode: 409, statusMessage: 'This address already has an account: log in to accept' })
    await consume(tx, invite.id, now)
    const [user] = await tx.insert(users).values({ email: invite.email, passwordHash, locale, emailVerifiedAt: now }).returning()
    await tx.insert(consents).values({ userId: user!.id, kind: 'terms', version: TERMS_VERSION })
    await tx.insert(siteMembers).values({ siteId: invite.siteId, userId: user!.id, role: 'member' })
    return user!
  })
}

/** Out of the household and into a fresh, empty one of their own. Their devices stop getting its notifications. */
export async function moveOut(tx: Tx, userId: number) {
  await tx.delete(siteMembers).where(eq(siteMembers.userId, userId))
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  return newHousehold(tx, userId, { controlMode: 'manual' })
}

export async function leaveHousehold(db: Db, userId: number) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(siteMembers).where(eq(siteMembers.userId, userId))
    if (m?.role !== 'member') throw createError({ statusCode: 400, statusMessage: "The owner can't leave the household" })
    return moveOut(tx, userId)
  })
}

export async function removeMember(db: Db, siteId: number, userId: number) {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(siteMembers)
      .where(and(eq(siteMembers.siteId, siteId), eq(siteMembers.userId, userId), eq(siteMembers.role, 'member')))
    if (!m) throw createError({ statusCode: 404, statusMessage: 'Member not found' })
    return moveOut(tx, userId)
  })
}
