import { eq } from 'drizzle-orm'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { setSignupMode, signUp } from '../server/services/setup'
import { issueToken } from '../server/services/tokens'
import { assertVerified, sendVerification, VERIFY_TTL_MS, verifyEmail } from '../server/services/verify'
import { freshDb, migrate, migrationTags, pgliteDb } from './support/pglite'

const rejects = (p: Promise<unknown>, statusCode: number) => expect(p).rejects.toMatchObject({ statusCode })
const userById = async (db: Db, id: number) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]!

describe('email verification', () => {
  let db: Db
  let userId: number
  beforeAll(async () => {
    db = await freshDb()
    await setSignupMode(db, 'open')
    userId = (await signUp(db, { email: 'verify@example.com', password: 'long-enough', locale: 'en', acceptTerms: true })).user.id
  })
  afterEach(() => vi.restoreAllMocks())

  it('starts unverified, so saving an integration is refused', async () => {
    const user = await userById(db, userId)
    expect(user.emailVerifiedAt).toBeNull()
    expect(() => assertVerified(user)).toThrow(expect.objectContaining({ statusCode: 403 }))
  })

  it('emails a link to /verify (dev transport)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const r = await sendVerification(db, await userById(db, userId), 'https://www.wattswise.eu')
    expect(r.ok).toBe(true)
    expect(info.mock.calls[0]![0]).toMatch(/https:\/\/www\.wattswise\.eu\/verify\?token=[\w-]+/)
  })

  it('verifies once, which unlocks connecting integrations', async () => {
    const token = await issueToken(db, userId, 'verify', VERIFY_TTL_MS)
    expect(await verifyEmail(db, token)).toBe(userId)
    const user = await userById(db, userId)
    expect(user.emailVerifiedAt).toBeInstanceOf(Date)
    expect(() => assertVerified(user)).not.toThrow()
    await rejects(verifyEmail(db, token), 400)
  })

  it('refuses an expired or unknown link', async () => {
    const old = await issueToken(db, userId, 'verify', VERIFY_TTL_MS, new Date(Date.now() - 2 * VERIFY_TTL_MS))
    await rejects(verifyEmail(db, old), 400)
    await rejects(verifyEmail(db, 'made-up'), 400)
  })
})

describe('migration 0013', () => {
  it('counts every account that existed before sign-up as verified', async () => {
    const pg = new PGlite()
    const at = migrationTags.indexOf('0013_email_verified')
    await migrate(pg, migrationTags.slice(0, at))
    await pg.query(`INSERT INTO users (email, password_hash) VALUES ('owner@example.com', 'x')`)
    await migrate(pg, migrationTags.slice(at))
    const [owner] = await pgliteDb(pg).select().from(schema.users)
    expect(owner!.emailVerifiedAt).toBeInstanceOf(Date)
  })
})
