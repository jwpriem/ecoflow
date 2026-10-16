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

/** Record the outcome of a call. A connection that was working and now fails sends an `errors` notification. */
export async function markIntegration(db: Db, id: number, error?: string) {
  const [before] = error ? await db.select({ status: integrations.status }).from(integrations).where(eq(integrations.id, id)) : []
  const [row] = await db
    .update(integrations)
    .set(error ? { status: 'error', lastError: error.slice(0, 500) } : { status: 'ok', lastError: null, lastOkAt: new Date() })
    .where(eq(integrations.id, id))
    .returning({ siteId: integrations.siteId, provider: integrations.provider })
  if (error && row && before?.status === 'ok') await notify(db, row.siteId, 'errors', integrationErrorMessage(row.provider, error))
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
