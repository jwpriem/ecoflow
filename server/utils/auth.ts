import type { H3Event } from 'h3'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { sessions, users } from '../db/schema'
import { assertAdmin, assertOwner, experimentalEnabled, sessionSite, touchSession } from '../services/members'
import { newToken, sha256 } from './crypto'

const SESSION_DAYS = 60

/** Bearer tokens (not cookies) so the same API works from the browser and from the Capacitor app. */
export async function createSession(userId: number, userAgent?: string) {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await useDb().insert(sessions).values({ userId, tokenHash: sha256(token), userAgent: userAgent?.slice(0, 200), expiresAt })
  return { token, expiresAt }
}

function bearerHash(event: H3Event) {
  const header = getHeader(event, 'authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Not logged in' })
  return sha256(token)
}

export async function requireUser(event: H3Event) {
  const [row] = await useDb()
    .select({ user: users, sessionId: sessions.id, lastUsedAt: sessions.lastUsedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, bearerHash(event)), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt)))
  if (!row) throw createError({ statusCode: 401, statusMessage: 'Session expired' })
  touchSession(useDb(), row.sessionId, row.lastUsedAt)
  return { ...row.user, sessionId: row.sessionId }
}

/**
 * The user's household and their role in it. One household per user for now (site_members.user_id is unique).
 * Session, user and site come in one query: every API call starts here.
 */
export async function requireSite(event: H3Event) {
  const row = await sessionSite(useDb(), bearerHash(event))
  if (!row) throw createError({ statusCode: 401, statusMessage: 'Session expired' })
  touchSession(useDb(), row.sessionId, row.sessionLastUsedAt)
  if (!row.site || !row.role) throw createError({ statusCode: 404, statusMessage: 'No site configured' })
  return { user: { ...row.user, sessionId: row.sessionId }, site: row.site, role: row.role, experimental: experimentalEnabled(row.owner) }
}

/** As requireSite, but only for the household's owner: steering, connections, members and deleting the household. */
export async function requireOwner(event: H3Event) {
  const ctx = await requireSite(event)
  assertOwner(ctx.role)
  return ctx
}

/** Only for admins (users.role), wherever their own household is. */
export async function requireAdmin(event: H3Event) {
  const user = await requireUser(event)
  assertAdmin(user)
  return user
}

export function encryptionKey(): string {
  const key = useRuntimeConfig().encryptionKey || process.env.NUXT_ENCRYPTION_KEY
  if (!key) throw createError({ statusCode: 500, statusMessage: 'NUXT_ENCRYPTION_KEY is not set' })
  return key
}
