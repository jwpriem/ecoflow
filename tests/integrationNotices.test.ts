import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { createAccount } from '../server/services/setup'
import { freshDb } from './support/pglite'

const notify = vi.fn(async () => ({ sent: 1, failed: 0 }))
vi.mock('../server/services/push', () => ({ notify: (...a: unknown[]) => notify(...(a as [])) }))

const { ERROR_NOTIFY_AFTER_MS, ERROR_NOTIFY_EVERY_MS, markIntegration, resetIntegrationNotices } = await import('../server/services/integrations')

describe('connection error notifications', () => {
  let db: Db
  let id: number
  const t0 = new Date('2026-11-20T12:00:00Z')
  const at = (ms: number) => new Date(t0.getTime() + ms)

  beforeAll(async () => {
    db = await freshDb()
    const { site } = await createAccount(db, 'owner@example.com', 'owner-password')
    const [row] = await db.insert(schema.integrations).values({ siteId: site.id, provider: 'ecoflow_official', credentialsEnc: 'x' }).returning()
    id = row!.id
  })

  beforeEach(async () => {
    notify.mockClear()
    resetIntegrationNotices()
    await markIntegration(db, id, undefined, t0)
  })

  it('stays quiet while the connection flaps between ok and error', async () => {
    for (let m = 1; m <= 30; m++) await markIntegration(db, id, m % 2 ? 'EcoFlow: Server error (code 1000)' : undefined, at(m * 60_000))
    expect(notify).not.toHaveBeenCalled()
  })

  it('notifies once a connection has failed for a while, then not again for hours', async () => {
    await markIntegration(db, id, 'down', at(60_000))
    expect(notify).not.toHaveBeenCalled()
    await markIntegration(db, id, 'down', at(ERROR_NOTIFY_AFTER_MS))
    expect(notify).toHaveBeenCalledTimes(1)
    await markIntegration(db, id, 'down', at(ERROR_NOTIFY_AFTER_MS + 60_000))
    expect(notify).toHaveBeenCalledTimes(1)
    await markIntegration(db, id, 'down', at(ERROR_NOTIFY_AFTER_MS + ERROR_NOTIFY_EVERY_MS))
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('notifies again for a new outage after it recovered', async () => {
    await markIntegration(db, id, 'down', at(ERROR_NOTIFY_AFTER_MS))
    await markIntegration(db, id, undefined, at(ERROR_NOTIFY_AFTER_MS + 60_000))
    await markIntegration(db, id, 'down', at(2 * ERROR_NOTIFY_AFTER_MS + 60_000))
    expect(notify).toHaveBeenCalledTimes(2)
  })
})
