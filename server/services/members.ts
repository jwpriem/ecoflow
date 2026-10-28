import { and, eq, gt } from 'drizzle-orm'
import type { Db } from '../db/client'
import { sessions, siteMembers, sites, users } from '../db/schema'

/**
 * Session, user, household and role for a token hash, in one query: every API call starts here.
 * The household comes only from the user's own membership, so one user can never resolve another's site.
 * Null when the session is unknown or expired; `site` and `role` are null for a user without a household.
 */
export async function sessionSite(db: Db, tokenHash: string) {
  const [row] = await db
    .select({ user: users, sessionId: sessions.id, site: sites, role: siteMembers.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(siteMembers, eq(siteMembers.userId, users.id))
    .leftJoin(sites, eq(sites.id, siteMembers.siteId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1)
  return row ?? null
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
