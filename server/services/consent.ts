import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { Db } from '../db/client'
import { consents, type sites } from '../db/schema'
import { STEERING_VERSION } from '../lib/legal'

type Site = typeof sites.$inferSelect

export async function hasConsent(db: Db, userId: number, kind: 'terms' | 'steering', version: string) {
  const [row] = await db
    .select({ v: consents.version })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.kind, kind), eq(consents.version, version)))
  return !!row
}

export async function recordConsent(db: Db, userId: number, kind: 'terms' | 'steering', version: string) {
  await db.insert(consents).values({ userId, kind, version }).onConflictDoNothing()
}

/**
 * Before WattsWise may start steering a household, the user turning it on must have accepted the current
 * steering disclaimer. Refused with 409 and `data.consent`, so the app shows the disclaimer and asks.
 */
export async function assertSteeringConsent(db: Db, userId: number) {
  if (await hasConsent(db, userId, 'steering', STEERING_VERSION)) return
  throw createError({ statusCode: 409, statusMessage: 'Accept the steering terms first', data: { consent: 'steering', version: STEERING_VERSION } })
}

/**
 * The owner of a household that WattsWise steers, without the current disclaimer accepted (it changed since):
 * steering keeps running, and the app asks them to read and accept the new version.
 */
export async function steeringConsentDue(db: Db, site: Site, userId: number, role: 'owner' | 'member') {
  return role === 'owner' && site.controlMode === 'auto' && !(await hasConsent(db, userId, 'steering', STEERING_VERSION))
}
