import type { H3Event } from 'h3'
import { and, eq, gt } from 'drizzle-orm'
import { sessions, sites, users } from '../db/schema'
import { newToken, sha256 } from './crypto'

const SESSION_DAYS = 60

/** Bearer tokens (not cookies) so the same API works from the browser and from the Capacitor app. */
export async function createSession(userId: number, userAgent?: string) {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await useDb().insert(sessions).values({ userId, tokenHash: sha256(token), userAgent: userAgent?.slice(0, 200), expiresAt })
  return { token, expiresAt }
}

export async function requireUser(event: H3Event) {
  const header = getHeader(event, 'authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Not logged in' })
  const [row] = await useDb()
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
  if (!row) throw createError({ statusCode: 401, statusMessage: 'Session expired' })
  return { ...row.user, sessionId: row.sessionId }
}

/** The user's site. Single site per user for now; the data model already allows more. */
export async function requireSite(event: H3Event) {
  const user = await requireUser(event)
  const [site] = await useDb().select().from(sites).where(eq(sites.userId, user.id)).limit(1)
  if (!site) throw createError({ statusCode: 404, statusMessage: 'No site configured' })
  return { user, site }
}

export function encryptionKey(): string {
  const key = useRuntimeConfig().encryptionKey || process.env.NUXT_ENCRYPTION_KEY
  if (!key) throw createError({ statusCode: 500, statusMessage: 'NUXT_ENCRYPTION_KEY is not set' })
  return key
}
