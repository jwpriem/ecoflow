import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import { authTokens, type AuthTokenKind } from '../db/schema'
import { newToken, sha256 } from '../utils/crypto'

/** A new single-use token for the user. Earlier unused tokens of the same kind stop working: only the latest email counts. */
export async function issueToken(db: Db, userId: number, kind: AuthTokenKind, ttlMs: number, now = new Date()): Promise<string> {
  const token = newToken()
  await db.transaction(async (tx) => {
    await tx.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)))
    await tx.insert(authTokens).values({ userId, kind, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + ttlMs) })
  })
  return token
}

/** Uses up a token in one statement, so two requests with the same link can't both succeed. The user's id, or null. */
export async function consumeToken(db: Db, kind: AuthTokenKind, token: string, now = new Date()): Promise<number | null> {
  if (!token) return null
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
    .returning({ userId: authTokens.userId })
  return row?.userId ?? null
}
