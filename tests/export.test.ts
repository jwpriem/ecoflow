import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { EXPORT_FORMAT, exportChunks } from '../server/services/export'
import { createInvite, signUpWithInvite } from '../server/services/household'
import { createAccount } from '../server/services/setup'
import { freshDb } from './support/pglite'

const collect = async (db: Db, userId: number, pageSize?: number) => {
  let text = ''
  for await (const chunk of exportChunks(db, userId, pageSize)) text += chunk
  return { text, data: JSON.parse(text) }
}

/** Every key anywhere in the export */
const keys = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keys) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []

describe('data export', () => {
  let db: Db
  let ownerId: number
  let memberId: number
  let ownerHash: string

  beforeAll(async () => {
    db = await freshDb()
    const a = await createAccount(db, 'owner@example.com', 'owner-password')
    ownerId = a.user.id
    ownerHash = a.user.passwordHash
    const siteId = a.site.id
    const { token } = await createInvite(db, { siteId, invitedBy: ownerId, email: 'member@example.com' })
    memberId = (await signUpWithInvite(db, { token, password: 'member-password', acceptTerms: true })).id
    await db.insert(schema.integrations).values({ siteId, provider: 'tibber', credentialsEnc: 'ENCRYPTED-SECRET', meta: { homeId: 'h1' } })
    const [d1, d2] = await db.insert(schema.devices).values([{ siteId, serial: 'BK-1', name: 'Stream 1' }, { siteId, serial: 'BK-2', name: 'Stream 2' }]).returning()
    const t0 = Date.UTC(2026, 9, 1)
    await db.insert(schema.samples).values(
      Array.from({ length: 7 }, (_, i) => ({ siteId, deviceId: d1!.id, ts: new Date(t0 + i * 60_000), kind: 'battery' as const, powerW: i, soc: 50 })),
    )
    const slot = { chargedSolarKwh: 0, chargedGridKwh: 0, dischargedKwh: 0, priceTotal: 0.2, priceFeedIn: 0.1, costNaive: 0, costOpportunity: 0, valueDischarged: 0, savingNaive: 0, savingOpportunity: 0 }
    await db.insert(schema.ledger).values([
      ...[0, 1, 2].map((i) => ({ ...slot, siteId, deviceId: d1!.id, slotStart: new Date(t0 + i * 900_000) })),
      ...[0, 1].map((i) => ({ ...slot, siteId, deviceId: d2!.id, slotStart: new Date(t0 + i * 900_000) })),
    ])
    await db.insert(schema.prices).values({ siteId, slotStart: new Date(t0), energy: 0.1, tax: 0.1, total: 0.2, feedIn: 0.1, source: 'tibber' })
    for (const [userId, n] of [[ownerId, 1], [memberId, 2]] as const) {
      await db.insert(schema.pushSubscriptions).values({ siteId, userId, endpoint: `https://push.example/SECRET-ENDPOINT-${n}`, p256dh: 'SECRET-KEY', auth: 'SECRET-AUTH' })
    }
  })

  it('holds the profile, household settings and every row, across pages, in valid JSON', async () => {
    const { data } = await collect(db, ownerId, 3)
    expect(data).toMatchObject({
      format: EXPORT_FORMAT,
      profile: { email: 'owner@example.com', locale: 'nl' },
      household: { name: 'Home', controlMode: 'auto', yourRole: 'owner' },
      connections: [{ provider: 'tibber', status: 'unknown' }],
      notifications: [{ topics: expect.any(Array) }],
    })
    expect(data.household.strategy).toMatchObject({ reserveSoc: expect.any(Number) })
    expect(data.devices.map((d: any) => d.serial)).toEqual(['BK-1', 'BK-2'])
    expect(data.samples.map((s: any) => s.powerW)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(data.ledger).toHaveLength(5)
    expect(data.prices).toHaveLength(1)
    expect(data.samples[0]).not.toHaveProperty('siteId')
  })

  it('never holds secrets: no credentials, password hash, tokens or push endpoint and keys', async () => {
    for (const userId of [ownerId, memberId]) {
      const { text, data } = await collect(db, userId)
      expect(keys(data).filter((k) => /password|token|credential|secret|endpoint|p256dh|^auth$/i.test(k))).toEqual([])
      for (const secret of ['ENCRYPTED-SECRET', 'SECRET-ENDPOINT', 'SECRET-KEY', 'SECRET-AUTH', ownerHash]) expect(text).not.toContain(secret)
    }
  })

  it('gives a member the household data and only their own profile', async () => {
    const [owner, member] = [(await collect(db, ownerId)).data, await collect(db, memberId)]
    expect(member.data.profile.email).toBe('member@example.com')
    expect(member.data.household.yourRole).toBe('member')
    expect(member.text).not.toContain('owner@example.com')
    expect(member.data.notifications).toHaveLength(1)
    for (const k of ['devices', 'samples', 'ledger', 'prices', 'connections']) expect(member.data[k]).toEqual(owner[k])
  })
})
