import { and, eq, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { sendEmail } from './email'
import { consumeToken, issueToken } from './tokens'

export const VERIFY_TTL_MS = 24 * 60 * 60_000

type User = typeof users.$inferSelect

/** Emails a fresh verification link; the older one stops working. `baseUrl` is the app's public URL. */
export async function sendVerification(db: Db, user: Pick<User, 'id' | 'email' | 'locale'>, baseUrl: string) {
  const token = await issueToken(db, user.id, 'verify', VERIFY_TTL_MS)
  return sendEmail(user.email, 'verify', { url: `${baseUrl}/verify?token=${encodeURIComponent(token)}` }, user.locale)
}

/** Marks the address as verified. Works without being logged in: the link may open on another device. */
export async function verifyEmail(db: Db, token: string): Promise<number> {
  const userId = await consumeToken(db, 'verify', token)
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'This link has expired or was already used' })
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
  return userId
}

/** Connecting an integration needs a verified address: credentials stay tied to someone who can be reached. */
export function assertVerified(user: Pick<User, 'emailVerifiedAt'>) {
  if (!user.emailVerifiedAt) throw createError({ statusCode: 403, statusMessage: 'Confirm your email address first' })
}
