import { eq } from 'drizzle-orm'
import * as h3 from 'h3'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { createAccount } from '../server/services/setup'
import { freshDb } from './support/pglite'

/**
 * Two households, A and B (security audit, task 6). The real route handlers run on an in-process Postgres with a
 * real session for each user; every way A could reach B's records by id must come back empty-handed, and B's
 * rows must be unchanged afterwards.
 *
 * The handlers use Nitro's auto-imports, so those are put on globalThis before the handlers are imported.
 */
const KEY = Buffer.alloc(32, 9).toString('base64')
let db: Db
let call: (method: string, path: string, token: string, body?: unknown) => Promise<{ status: number; json: any }>
let a: { token: string; siteId: number; userId: number }
let b: { token: string; siteId: number; userId: number }
const ids: Record<string, number> = {}

const ROUTES: [string, string, string][] = [
  ['GET', '/api/devices', 'devices/index.get.ts'],
  ['PUT', '/api/devices/:id', 'devices/[id].put.ts'],
  ['GET', '/api/vehicles/:id/plan', 'vehicles/[id]/plan.get.ts'],
  ['PUT', '/api/vehicles/:id', 'vehicles/[id].put.ts'],
  ['GET', '/api/lights/floors', 'lights/floors/index.get.ts'],
  ['PUT', '/api/lights/floors/:id', 'lights/floors/[id].put.ts'],
  ['DELETE', '/api/lights/floors/:id', 'lights/floors/[id].delete.ts'],
  ['GET', '/api/sonos/sounds', 'sonos/sounds/index.get.ts'],
  ['DELETE', '/api/sonos/sounds/:id', 'sonos/sounds/[id].delete.ts'],
  ['DELETE', '/api/household/members/:id', 'household/members/[id].delete.ts'],
  ['DELETE', '/api/household/invites/:id', 'household/invites/[id].delete.ts'],
  ['GET', '/api/household', 'household/index.get.ts'],
  ['GET', '/api/integrations', 'integrations/index.get.ts'],
  ['GET', '/api/admin/users', 'admin/users/index.get.ts'],
  ['PUT', '/api/admin/users/:id', 'admin/users/[id].put.ts'],
]

beforeAll(async () => {
  db = await freshDb()
  // Nitro auto-imports, as the server has them
  const auth = await import('../server/utils/auth')
  const limits = await import('../server/utils/limits')
  Object.assign(globalThis, h3, {
    useDb: () => db,
    useRuntimeConfig: () => ({ encryptionKey: KEY, appUrl: 'https://test.local', public: {} }),
    appBaseUrl: () => 'https://test.local',
    ...auth,
    ...limits,
  })

  const app = h3.createApp()
  const router = h3.createRouter()
  for (const [method, path, file] of ROUTES) {
    const handler = (await import(/* @vite-ignore */ `../server/api/${file}`)).default
    router.use(path, handler, method.toLowerCase() as h3.RouterMethod)
  }
  app.use(router)
  const web = h3.toWebHandler(app)
  call = async (method, path, token, body) => {
    const res = await web(
      new Request(`https://test.local${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    const text = await res.text()
    return { status: res.status, json: text ? JSON.parse(text) : null }
  }

  const make = async (email: string) => {
    const { user, site } = await createAccount(db, email, 'a-long-password')
    // Experimental on, so the lights and Sonos routes answer at all
    await db.update(schema.users).set({ experimental: true, emailVerifiedAt: new Date() }).where(eq(schema.users.id, user.id))
    const { token } = await auth.createSession(user.id)
    return { token, siteId: site.id, userId: user.id }
  }
  a = await make('a@example.com')
  b = await make('b@example.com')

  // B's records
  const [dev] = await db.insert(schema.devices).values({ siteId: b.siteId, serial: 'B-SERIAL', name: 'B battery' }).returning()
  const [car] = await db.insert(schema.vehicles).values({ siteId: b.siteId, vin: 'B-VIN', name: 'B car' }).returning()
  const [floor] = await db.insert(schema.lightFloors).values({ siteId: b.siteId, name: 'B floor' }).returning()
  const [sound] = await db.insert(schema.doorbellSounds).values({ siteId: b.siteId, name: 'B sound', mime: 'audio/mpeg', audio: 'AAAA', token: 'x'.repeat(32) }).returning()
  const [invite] = await db
    .insert(schema.householdInvites)
    .values({ siteId: b.siteId, email: 'friend@example.com', tokenHash: 'h', invitedBy: b.userId, expiresAt: new Date(Date.now() + 86_400_000) })
    .returning()
  // A second user in B's household, to try to remove
  const { user: bMember } = await createAccount(db, 'b-member@example.com', 'a-long-password')
  await db.delete(schema.siteMembers).where(eq(schema.siteMembers.userId, bMember.id))
  await db.insert(schema.siteMembers).values({ siteId: b.siteId, userId: bMember.id, role: 'member' })
  Object.assign(ids, { device: dev!.id, car: car!.id, floor: floor!.id, sound: sound!.id, invite: invite!.id, member: bMember.id })
})

describe('user isolation: A cannot reach B by id', () => {
  it('cannot change B’s battery', async () => {
    const r = await call('PUT', `/api/devices/${ids.device}`, a.token, { name: 'hacked', serial: 'A-SERIAL' })
    expect(r.status).toBe(404)
    const [row] = await db.select().from(schema.devices).where(eq(schema.devices.id, ids.device!))
    expect(row).toMatchObject({ name: 'B battery', serial: 'B-SERIAL', siteId: b.siteId })
  })

  it('cannot read or change B’s car', async () => {
    expect((await call('GET', `/api/vehicles/${ids.car}/plan`, a.token)).status).toBe(404)
    expect((await call('PUT', `/api/vehicles/${ids.car}`, a.token, { name: 'hacked' })).status).toBe(404)
    const [row] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, ids.car!))
    expect(row!.name).toBe('B car')
  })

  it('cannot change or delete B’s floor plan', async () => {
    expect((await call('PUT', `/api/lights/floors/${ids.floor}`, a.token, { name: 'hacked' })).status).toBe(404)
    await call('DELETE', `/api/lights/floors/${ids.floor}`, a.token)
    const [row] = await db.select().from(schema.lightFloors).where(eq(schema.lightFloors.id, ids.floor!))
    expect(row?.name).toBe('B floor')
  })

  it('cannot delete B’s doorbell sound', async () => {
    await call('DELETE', `/api/sonos/sounds/${ids.sound}`, a.token)
    const rows = await db.select().from(schema.doorbellSounds).where(eq(schema.doorbellSounds.id, ids.sound!))
    expect(rows).toHaveLength(1)
  })

  it('cannot remove B’s member or revoke B’s invitation', async () => {
    await call('DELETE', `/api/household/members/${ids.member}`, a.token).catch(() => null)
    await call('DELETE', `/api/household/invites/${ids.invite}`, a.token).catch(() => null)
    const [m] = await db.select().from(schema.siteMembers).where(eq(schema.siteMembers.userId, ids.member!))
    expect(m).toMatchObject({ siteId: b.siteId, role: 'member' })
    const [inv] = await db.select().from(schema.householdInvites).where(eq(schema.householdInvites.id, ids.invite!))
    expect(inv).toBeDefined()
  })
})

describe('user isolation: lists only show the own household', () => {
  it('devices, floors, sounds, household and integrations of A hold nothing of B', async () => {
    for (const path of ['/api/devices', '/api/lights/floors', '/api/sonos/sounds', '/api/household', '/api/integrations']) {
      const r = await call('GET', path, a.token)
      expect(r.status, path).toBe(200)
      const text = JSON.stringify(r.json)
      for (const secret of ['B battery', 'B-SERIAL', 'B floor', 'B sound', 'b@example.com', 'b-member@example.com', 'friend@example.com']) {
        expect(text, `${path} leaks ${secret}`).not.toContain(secret)
      }
    }
  })

  it('B sees their own records', async () => {
    const r = await call('GET', '/api/devices', b.token)
    expect(r.json.map((d: { name: string }) => d.name)).toEqual(['B battery'])
  })
})

describe('user isolation: no session, a bad session, or a normal user on admin routes', () => {
  it('refuses a missing or unknown token', async () => {
    expect((await call('GET', '/api/devices', '')).status).toBe(401)
    expect((await call('GET', '/api/devices', 'not-a-session')).status).toBe(401)
  })

  it('refuses admin routes to a normal user, and A cannot make themself admin', async () => {
    expect((await call('GET', '/api/admin/users', a.token)).status).toBe(403)
    expect((await call('PUT', `/api/admin/users/${a.userId}`, a.token, { admin: true })).status).toBe(403)
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, a.userId))
    expect(row!.role).toBe('user')
  })
})

describe('SolarEdge sign-in without state', () => {
  it('only finishes the household whose browser started it', async () => {
    const { markSolarEdgeAuthStarted, pendingSolarEdgeSiteFor } = await import('../server/services/solaredge')
    const { saveIntegration, getIntegration } = await import('../server/services/integrations')
    await saveIntegration(db, b.siteId, 'solaredge', { clientId: 'c', clientSecret: 's' }, {}, KEY)
    await markSolarEdgeAuthStarted(db, (await getIntegration(db, b.siteId, 'solaredge', KEY))!, KEY)
    // B's own browser (cookie for B) may finish it; no cookie, or A's cookie, may not
    expect(await pendingSolarEdgeSiteFor(db, b.siteId)).toBe(b.siteId)
    expect(await pendingSolarEdgeSiteFor(db, undefined)).toBeUndefined()
    expect(await pendingSolarEdgeSiteFor(db, a.siteId)).toBeUndefined()
  })
})
