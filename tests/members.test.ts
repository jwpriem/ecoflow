import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { ownerEmail, sessionSite } from '../server/services/members'
import { createAccount } from '../server/services/setup'
import { defaultStrategy } from '../server/lib/types'
import { sha256 } from '../server/utils/crypto'

const dir = 'server/db/migrations'
const journal = JSON.parse(readFileSync(`${dir}/meta/_journal.json`, 'utf8')) as { entries: { tag: string }[] }

/** Apply the real migration files in order. PGlite has no pg_stat_statements, so extensions are skipped. */
async function migrate(pg: PGlite, tags: string[]) {
  for (const tag of tags) {
    for (const stmt of readFileSync(`${dir}/${tag}.sql`, 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim() && !/CREATE EXTENSION/i.test(stmt)) await pg.exec(stmt)
    }
  }
}

async function session(db: Db, userId: number, token: string, expiresAt = new Date(Date.now() + 86_400_000)) {
  await db.insert(schema.sessions).values({ userId, tokenHash: sha256(token), expiresAt })
}

describe('households', () => {
  let db: Db
  let legacy: { userId: number; siteId: number }

  beforeAll(async () => {
    const pg = new PGlite()
    const tags = journal.entries.map((e) => e.tag)
    const at = tags.indexOf('0009_site_members')
    // A household from before site_members, to check the backfill.
    await migrate(pg, tags.slice(0, at))
    db = drizzle(pg, { schema }) as unknown as Db
    const [user] = await db.insert(schema.users).values({ email: 'owner@example.com', passwordHash: 'x' }).returning()
    const [site] = await db.insert(schema.sites).values({ userId: user!.id, name: 'Home', strategy: defaultStrategy }).returning()
    legacy = { userId: user!.id, siteId: site!.id }
    await migrate(pg, tags.slice(at))
  })

  it('makes the creator of an existing site its owner', async () => {
    await session(db, legacy.userId, 'legacy')
    const row = await sessionSite(db, sha256('legacy'))
    expect(row?.site?.id).toBe(legacy.siteId)
    expect(row?.role).toBe('owner')
    expect(await ownerEmail(db, legacy.siteId)).toBe('owner@example.com')
  })

  it('never resolves another user\'s household', async () => {
    const a = await createAccount(db, 'a@example.com', 'password-a', 'A')
    const b = await createAccount(db, 'B@Example.com ', 'password-b', 'B')
    await session(db, a.user.id, 'token-a')
    await session(db, b.user.id, 'token-b')
    expect((await sessionSite(db, sha256('token-a')))?.site?.id).toBe(a.site.id)
    expect((await sessionSite(db, sha256('token-b')))?.site?.id).toBe(b.site.id)
    expect((await sessionSite(db, sha256('token-b')))?.role).toBe('owner')
  })

  it('gives a member the owner\'s household with the member role', async () => {
    const owner = await createAccount(db, 'house@example.com', 'password-o')
    const [member] = await db.insert(schema.users).values({ email: 'partner@example.com', passwordHash: 'x' }).returning()
    await db.insert(schema.siteMembers).values({ siteId: owner.site.id, userId: member!.id, role: 'member' })
    await session(db, member!.id, 'token-member')
    const row = await sessionSite(db, sha256('token-member'))
    expect(row?.site?.id).toBe(owner.site.id)
    expect(row?.role).toBe('member')
    expect(row?.user.email).toBe('partner@example.com')
    expect(await ownerEmail(db, owner.site.id)).toBe('house@example.com')
  })

  it('allows only one household per user', async () => {
    const other = await createAccount(db, 'other@example.com', 'password-x')
    await expect(db.insert(schema.siteMembers).values({ siteId: other.site.id, userId: legacy.userId, role: 'member' })).rejects.toThrow()
  })

  it('returns no household for a user without a membership', async () => {
    const [user] = await db.insert(schema.users).values({ email: 'alone@example.com', passwordHash: 'x' }).returning()
    await session(db, user!.id, 'token-alone')
    const row = await sessionSite(db, sha256('token-alone'))
    expect(row?.user.id).toBe(user!.id)
    expect(row?.site).toBeNull()
    expect(row?.role).toBeNull()
  })

  it('rejects unknown and expired sessions', async () => {
    await session(db, legacy.userId, 'expired', new Date(Date.now() - 1000))
    expect(await sessionSite(db, sha256('expired'))).toBeNull()
    expect(await sessionSite(db, sha256('nope'))).toBeNull()
  })
})
