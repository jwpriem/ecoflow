import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { TERMS_VERSION } from '../server/lib/legal'
import { RateLimiter } from '../server/lib/rateLimit'
import { setSignupMode, signUp, signupMode } from '../server/services/setup'
import { verifyPassword } from '../server/utils/crypto'
import { freshDb } from './support/pglite'

const valid = { email: 'New@Example.com ', password: 'long-enough', locale: 'en', acceptTerms: true }
const rejects = (p: Promise<unknown>, statusCode: number) => expect(p).rejects.toMatchObject({ statusCode })

describe('signUp', () => {
  let db: Db
  beforeAll(async () => {
    db = await freshDb()
  })

  it('is closed until the admin opens it', async () => {
    expect(await signupMode(db)).toBe('closed')
    await rejects(signUp(db, valid), 403)
    await setSignupMode(db, 'open')
    expect(await signupMode(db)).toBe('open')
  })

  it('creates the user, a household that only monitors, the owner membership and the accepted terms', async () => {
    const r = await signUp(db, valid)
    expect(r.created).toBe(true)
    expect(r.user).toMatchObject({ email: 'new@example.com', locale: 'en', role: 'user', experimental: false })
    expect(await verifyPassword('long-enough', r.user.passwordHash)).toBe(true)
    const [m] = await db.select().from(schema.siteMembers).where(eq(schema.siteMembers.userId, r.user.id))
    expect(m?.role).toBe('owner')
    const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, m!.siteId))
    expect(site?.controlMode).toBe('manual')
    const c = await db.select().from(schema.consents).where(eq(schema.consents.userId, r.user.id))
    expect(c).toEqual([expect.objectContaining({ kind: 'terms', version: TERMS_VERSION })])
  })

  it('answers without creating anything for an address that already has an account', async () => {
    const r = await signUp(db, { ...valid, email: 'new@example.com', password: 'another-password' })
    expect(r.created).toBe(false)
    expect(await db.select().from(schema.users).where(eq(schema.users.email, 'new@example.com'))).toHaveLength(1)
    // The existing password is untouched
    expect(await verifyPassword('long-enough', r.user.passwordHash)).toBe(true)
  })

  it('needs the terms, a real address and a password of 8 characters', async () => {
    await rejects(signUp(db, { ...valid, email: 'x@example.com', acceptTerms: false }), 400)
    await rejects(signUp(db, { ...valid, email: 'not-an-email' }), 400)
    await rejects(signUp(db, { ...valid, email: 'y@example.com', password: 'short' }), 400)
  })

  it('falls back to Dutch for an unknown language', async () => {
    expect((await signUp(db, { ...valid, email: 'z@example.com', locale: 'fr' })).user.locale).toBe('nl')
  })
})

describe('RateLimiter', () => {
  it('allows the limit per window, then refuses until the window ends', () => {
    const l = new RateLimiter(3, 1000)
    expect([l.hit('a', 0), l.hit('a', 1), l.hit('a', 2), l.hit('a', 3)]).toEqual([true, true, true, false])
    expect(l.hit('b', 3)).toBe(true)
    expect(l.hit('a', 1000)).toBe(true)
  })

  it('starts over after a reset', () => {
    const l = new RateLimiter(1, 1000)
    l.hit('a', 0)
    expect(l.hit('a', 1)).toBe(false)
    l.reset('a')
    expect(l.hit('a', 2)).toBe(true)
  })
})
