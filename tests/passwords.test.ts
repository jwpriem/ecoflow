import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { changePassword, confirmReset, logOutEverywhere, requestReset, RESET_TTL_MS } from '../server/services/passwords'
import { createAccount } from '../server/services/setup'
import { consumeToken, issueToken } from '../server/services/tokens'
import { sha256, verifyPassword } from '../server/utils/crypto'
import { freshDb } from './support/pglite'

const rejects = (p: Promise<unknown>, statusCode: number) => expect(p).rejects.toMatchObject({ statusCode })

describe('password reset', () => {
  let db: Db
  let userId: number
  const sessionsOf = async () => db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId))
  const addSessions = async (...tokens: string[]) => {
    const rows = await db
      .insert(schema.sessions)
      .values(tokens.map((t) => ({ userId, tokenHash: sha256(t + Math.random()), expiresAt: new Date(Date.now() + 86_400_000) })))
      .returning()
    return rows.map((r) => r.id)
  }
  const password = async () => (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]!.passwordHash

  beforeAll(async () => {
    db = await freshDb()
    userId = (await createAccount(db, 'reset@example.com', 'old-password')).user.id
  })

  it('gives no token for an unknown address', async () => {
    expect(await requestReset(db, 'nobody@example.com')).toBeNull()
  })

  it('sets the new password and logs out every session', async () => {
    await addSessions('phone', 'laptop')
    const r = await requestReset(db, ' Reset@Example.com')
    await confirmReset(db, r!.token, 'new-password')
    expect(await verifyPassword('new-password', await password())).toBe(true)
    expect(await sessionsOf()).toHaveLength(0)
  })

  it('accepts a token only once', async () => {
    const { token } = (await requestReset(db, 'reset@example.com'))!
    await confirmReset(db, token, 'newer-password')
    await rejects(confirmReset(db, token, 'third-password'), 400)
    expect(await verifyPassword('newer-password', await password())).toBe(true)
  })

  it('refuses an expired token', async () => {
    const token = await issueToken(db, userId, 'reset', RESET_TTL_MS, new Date(Date.now() - 2 * RESET_TTL_MS))
    await rejects(confirmReset(db, token, 'too-late-password'), 400)
  })

  it('only honours the latest email', async () => {
    const first = (await requestReset(db, 'reset@example.com'))!.token
    const second = (await requestReset(db, 'reset@example.com'))!.token
    await rejects(confirmReset(db, first, 'from-first-mail'), 400)
    await confirmReset(db, second, 'from-second-mail')
  })

  it('needs a password of 8 characters and keeps the token for a retry', async () => {
    const { token } = (await requestReset(db, 'reset@example.com'))!
    await rejects(confirmReset(db, token, 'short'), 400)
    await confirmReset(db, token, 'long-enough-now')
  })

  it('keeps tokens apart by kind', async () => {
    const token = await issueToken(db, userId, 'verify', RESET_TTL_MS)
    expect(await consumeToken(db, 'reset', token)).toBeNull()
    expect(await consumeToken(db, 'verify', token)).toBe(userId)
  })
})

describe('changing the password while logged in', () => {
  let db: Db
  let userId: number
  beforeAll(async () => {
    db = await freshDb()
    userId = (await createAccount(db, 'change@example.com', 'old-password')).user.id
  })

  it('needs the current password, then ends every other session', async () => {
    const [here, other] = await db
      .insert(schema.sessions)
      .values(['here', 'other'].map((t) => ({ userId, tokenHash: sha256(t), expiresAt: new Date(Date.now() + 86_400_000) })))
      .returning()
    await rejects(changePassword(db, userId, here!.id, 'wrong-password', 'new-password'), 400)
    await changePassword(db, userId, here!.id, 'old-password', 'new-password')
    const left = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId))
    expect(left.map((s) => s.id)).toEqual([here!.id])
    expect(other).toBeDefined()
  })

  it('logs out everywhere, this session too', async () => {
    await logOutEverywhere(db, userId)
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId))).toHaveLength(0)
  })
})
