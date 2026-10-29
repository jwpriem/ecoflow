import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { consents, devices, integrations, type Provider, siteMembers, sites, users } from '../db/schema'
import type { SiteLocation } from '../lib/location'
import { STEERING_VERSION, TERMS_VERSION } from '../lib/legal'
import { encryptJson, hashPassword } from '../utils/crypto'
import { newHousehold } from './setup'

/** The demo account (JER-39): what Apple's reviewer and curious visitors see, without any hardware of their own */
export const DEMO_EMAIL = 'demo@wattswise.eu'
const DEMO_NAME = 'Demo household'
const DEMO_LOCATION: SiteLocation = { lat: 52.1, lon: 5.1, place: 'Utrecht', source: 'manual' }

/** Connections that look set up but hold no credentials: the jobs that would use them skip the demo household */
const DEMO_CONNECTIONS: { provider: Provider; meta: Record<string, unknown> }[] = [
  { provider: 'tibber', meta: { homeId: 'demo', homeName: DEMO_NAME, realtime: true } },
  { provider: 'ecoflow_official', meta: { steering: 'wattwise' } },
  { provider: 'solaredge', meta: { siteId: 'demo', siteName: DEMO_NAME, lastTest: { peakPower: 3.6 } } },
]

const DEMO_BATTERIES = [
  { serial: 'DEMO-STREAM-PRO-1', name: 'Living room' },
  { serial: 'DEMO-STREAM-PRO-2', name: 'Garage' },
]

/**
 * Creates the demo account and its household, or brings an existing one back in line: run it as often as you
 * like. The password comes from NUXT_DEMO_PASSWORD; the demo user is never an admin or experimental (no cars).
 */
export async function seedDemo(db: Db, password: string, keyB64: string, now = new Date()) {
  const passwordHash = await hashPassword(password)
  return db.transaction(async (tx) => {
    const fixed = { passwordHash, role: 'user' as const, experimental: false, disabledAt: null }
    let [user] = await tx.select().from(users).where(eq(users.email, DEMO_EMAIL))
    if (user) await tx.update(users).set(fixed).where(eq(users.id, user.id))
    else [user] = await tx.insert(users).values({ email: DEMO_EMAIL, locale: 'en', emailVerifiedAt: now, ...fixed }).returning()
    const userId = user!.id

    const [member] = await tx.select().from(siteMembers).where(eq(siteMembers.userId, userId))
    const siteId = member?.siteId ?? (await newHousehold(tx, userId, { siteName: DEMO_NAME })).id
    await tx
      .update(sites)
      .set({ isDemo: true, name: DEMO_NAME, controlMode: 'auto', override: null, onboarding: null, location: DEMO_LOCATION })
      .where(eq(sites.id, siteId))

    // Accepted, so the demo never stops at the terms or the steering disclaimer
    const accepted = await tx.select({ kind: consents.kind, version: consents.version }).from(consents).where(eq(consents.userId, userId))
    for (const [kind, version] of [['terms', TERMS_VERSION], ['steering', STEERING_VERSION]] as const) {
      if (!accepted.some((c) => c.kind === kind && c.version === version)) await tx.insert(consents).values({ userId, kind, version })
    }

    const credentialsEnc = encryptJson({ demo: true }, keyB64)
    for (const c of DEMO_CONNECTIONS) {
      await tx
        .insert(integrations)
        .values({ siteId, provider: c.provider, credentialsEnc, meta: c.meta, status: 'ok', lastOkAt: now, lastError: null })
        .onConflictDoUpdate({ target: [integrations.siteId, integrations.provider], set: { meta: c.meta, status: 'ok', lastError: null } })
    }
    for (const b of DEMO_BATTERIES) {
      await tx.insert(devices).values({ siteId, model: 'STREAM Pro', ...b }).onConflictDoNothing({ target: [devices.siteId, devices.serial] })
    }

    return { userId, siteId }
  })
}
