import { and, eq, gt, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { createError } from 'h3'
import type { Db } from '../db/client'
import { type MemberRole, sessions, siteMembers, sites, users, type UserRole } from '../db/schema'

const ownerMember = alias(siteMembers, 'owner_member')
const owner = alias(users, 'owner')

/** What decides the household-wide flags: the owner's role and experimental setting. */
export interface HouseholdOwner {
  role: UserRole
  experimental: boolean
}

/** Experimental integrations are per household: on when its owner has them switched on or is an admin. */
export function experimentalEnabled(owner: HouseholdOwner | null): boolean {
  return !!owner && (owner.experimental || owner.role === 'admin')
}

/**
 * Session, user, household, role and the household's owner for a token hash, in one query: every API call starts here.
 * The household comes only from the user's own membership, so one user can never resolve another's site.
 * Null when the session is unknown or expired, or the user is disabled; `site`, `role` and `owner` are null for a user without a household.
 */
export async function sessionSite(db: Db, tokenHash: string) {
  const [row] = await db
    .select({
      user: users,
      sessionId: sessions.id,
      sessionLastUsedAt: sessions.lastUsedAt,
      site: sites,
      role: siteMembers.role,
      owner: { role: owner.role, experimental: owner.experimental },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(siteMembers, eq(siteMembers.userId, users.id))
    .leftJoin(sites, eq(sites.id, siteMembers.siteId))
    .leftJoin(ownerMember, and(eq(ownerMember.siteId, sites.id), eq(ownerMember.role, 'owner')))
    .leftJoin(owner, eq(owner.id, ownerMember.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt)))
    .limit(1)
  return row ?? null
}

/** Throws a 403 unless the user is an admin. Kept apart from requireAdmin() so it can be tested without a request. */
export function assertAdmin(user: { role: UserRole }) {
  if (user.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Admins only' })
}

/**
 * Throws a 403 unless the user owns the household. Owner-only (JER-5): steering on or off, the connections,
 * the members and deleting the household. Members change everything else.
 */
export function assertOwner(role: MemberRole) {
  if (role !== 'owner') throw createError({ statusCode: 403, statusMessage: 'Only the household owner can do this' })
}

/** The owner's email, the contact of last resort for a household. */
export async function ownerEmail(db: Db, siteId: number): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(siteMembers)
    .innerJoin(users, eq(users.id, siteMembers.userId))
    .where(and(eq(siteMembers.siteId, siteId), eq(siteMembers.role, 'owner')))
    .limit(1)
  return row?.email ?? null
}

const TOUCH_MS = 5 * 60_000

/** Records that the session was used, at most every few minutes, so "last seen" costs no write per request. */
export function touchSession(db: Db, sessionId: number, lastUsedAt: Date | null, now = new Date()) {
  if (lastUsedAt && now.getTime() - lastUsedAt.getTime() < TOUCH_MS) return
  db.update(sessions)
    .set({ lastUsedAt: now })
    .where(eq(sessions.id, sessionId))
    .catch((err: Error) => console.warn('[auth] session touch failed:', err.message))
}
