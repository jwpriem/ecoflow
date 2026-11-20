import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { integrations, type Provider } from '../db/schema'
import { integrationErrorMessage } from '../lib/notifications'
import { decryptJson, encryptJson } from '../utils/crypto'
import { notify } from './push'

export async function getIntegration<T>(db: Db, siteId: number, provider: Provider, key: string) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.siteId, siteId), eq(integrations.provider, provider)))
  if (!row) return null
  return { row, creds: decryptJson<T>(row.credentialsEnc, key), meta: row.meta }
}

export async function saveIntegration(
  db: Db,
  siteId: number,
  provider: Provider,
  creds: unknown,
  meta: Record<string, unknown>,
  key: string,
) {
  const credentialsEnc = encryptJson(creds, key)
  await db
    .insert(integrations)
    .values({ siteId, provider, credentialsEnc, meta, status: 'unknown' })
    .onConflictDoUpdate({
      target: [integrations.siteId, integrations.provider],
      set: { credentialsEnc, meta, status: 'unknown', lastError: null, updatedAt: new Date() },
    })
}

/** A connection must have had no success for this long before an error notifies: a blip that recovers stays quiet */
export const ERROR_NOTIFY_AFTER_MS = 10 * 60_000
/** And it notifies at most this often per connection while it stays down */
export const ERROR_NOTIFY_EVERY_MS = 6 * 3600_000
const notifiedAt = new Map<number, number>()

/**
 * Record the outcome of a call. A connection that worked before and has now failed for ERROR_NOTIFY_AFTER_MS
 * sends an `errors` notification (once per ERROR_NOTIFY_EVERY_MS). A connection that flaps between ok and
 * error keeps having recent successes, so it doesn't notify on every flip.
 */
export async function markIntegration(db: Db, id: number, error?: string, now = new Date()) {
  const [before] = error ? await db.select({ status: integrations.status, lastOkAt: integrations.lastOkAt }).from(integrations).where(eq(integrations.id, id)) : []
  const [row] = await db
    .update(integrations)
    .set(error ? { status: 'error', lastError: error.slice(0, 500) } : { status: 'ok', lastError: null, lastOkAt: now })
    .where(eq(integrations.id, id))
    .returning({ siteId: integrations.siteId, provider: integrations.provider })
  if (!error) {
    notifiedAt.delete(id)
    return
  }
  if (!row || !before || before.status === 'unknown' || !before.lastOkAt) return
  const t = now.getTime()
  if (t - before.lastOkAt.getTime() < ERROR_NOTIFY_AFTER_MS) return
  const last = notifiedAt.get(id)
  if (last !== undefined && t - last < ERROR_NOTIFY_EVERY_MS) return
  notifiedAt.set(id, t)
  await notify(db, row.siteId, 'errors', integrationErrorMessage(row.provider, error))
}

/** For tests: forget which connections already notified */
export function resetIntegrationNotices() {
  notifiedAt.clear()
}

/** Replace the secrets and/or settings of an existing row without touching its status */
export async function updateIntegration(
  db: Db,
  id: number,
  patch: { creds?: unknown; meta?: Record<string, unknown> },
  key: string,
) {
  await db
    .update(integrations)
    .set({
      ...(patch.creds !== undefined ? { credentialsEnc: encryptJson(patch.creds, key) } : {}),
      ...(patch.meta ? { meta: patch.meta } : {}),
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, id))
}
