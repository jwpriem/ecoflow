import { and, eq, ne } from 'drizzle-orm'
import { createError } from 'h3'
import type { Db } from '../db/client'
import { sessions, users } from '../db/schema'
import { hashPassword, verifyPassword } from '../utils/crypto'
import { normalizeEmail } from './setup'
import { consumeToken, issueToken } from './tokens'

export const RESET_TTL_MS = 60 * 60_000

const checkNew = (password: unknown): string => {
  if (typeof password !== 'string' || password.length < 8) throw createError({ statusCode: 400, statusMessage: 'Choose a password of at least 8 characters' })
  return password
}

/** A reset token for the account with this email, or null when there is none. The caller answers the same either way. */
export async function requestReset(db: Db, email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(email)))
  if (!user) return null
  return { user, token: await issueToken(db, user.id, 'reset', RESET_TTL_MS) }
}

/** Sets the new password and ends every session of the user: whoever had the old password is out. */
export async function confirmReset(db: Db, token: string, password: unknown) {
  const next = checkNew(password)
  const userId = await consumeToken(db, 'reset', token)
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'This link has expired or was already used' })
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId))
  await logOutEverywhere(db, userId)
  return userId
}

/** Change it while logged in: needs the current password, and ends every other session but this one. */
export async function changePassword(db: Db, userId: number, sessionId: number, current: unknown, password: unknown) {
  const next = checkNew(password)
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user || !(await verifyPassword(String(current ?? ''), user.passwordHash))) {
    throw createError({ statusCode: 400, statusMessage: 'The current password is wrong' })
  }
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId))
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId)))
}

export async function logOutEverywhere(db: Db, userId: number) {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}
