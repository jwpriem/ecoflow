import { and, eq, max } from 'drizzle-orm'
import type { Db } from '../db/client'
import { samples, type sites } from '../db/schema'
import { pulseDownMessage, pulseUpMessage } from '../lib/notifications'
import { pulseWatchStep, type PulseWatchState } from '../lib/pulseWatch'
import type { TibberCredentials } from '../providers/tibber'
import { pulseStatus, pulseWatchdog, startPulse, stopPulse } from '../providers/tibberPulse'
import { getIntegration, updateIntegration } from './integrations'
import { notify } from './push'

/** (Re)start the Tibber Pulse stream for a site if Tibber is connected and the home has realtime data. */
export async function syncPulse(db: Db, site: typeof sites.$inferSelect, key: string) {
  const tibber = await getIntegration<TibberCredentials>(db, site.id, 'tibber', key)
  const homeId = tibber?.meta.homeId as string | undefined
  if (!tibber || !homeId || tibber.meta.realtime === false) {
    stopPulse(site.id)
    return false
  }
  startPulse(site.id, tibber.creds, homeId)
  return true
}

/**
 * Every collection tick: reconnect a stream that went silent, and send one `errors` notification when the Pulse
 * has given no readings for a while, plus one when readings come back.
 */
export async function watchPulse(db: Db, site: typeof sites.$inferSelect, key: string, now = new Date()) {
  const status = pulseStatus(site.id)
  if (!status.active) return
  pulseWatchdog(site.id, now.getTime())
  const tibber = await getIntegration<TibberCredentials>(db, site.id, 'tibber', key)
  if (!tibber) return
  const state = tibber.meta as PulseWatchState
  const p = { lastReadingAt: status.lastMessageAt, watchingSince: status.startedAt ?? now.getTime(), lastStoredAt: null as number | null }
  let step = pulseWatchStep(state, p, now.getTime())
  if (step.kind === 'down' && status.lastMessageAt === null) {
    // Quiet since this process started: the last stored reading says since when
    const [last] = await db.select({ ts: max(samples.ts) }).from(samples).where(and(eq(samples.siteId, site.id), eq(samples.kind, 'grid')))
    p.lastStoredAt = last?.ts ? new Date(last.ts).getTime() : null
    step = pulseWatchStep(state, p, now.getTime())
  }
  if (step.kind === 'none') return
  const { pulseDownSince: _, ...rest } = tibber.meta as Record<string, unknown>
  if (step.kind === 'down') {
    await updateIntegration(db, tibber.row.id, { meta: { ...rest, pulseDownSince: step.since.toISOString() } }, key)
    await notify(db, site.id, 'errors', pulseDownMessage(step.since, now, site.timezone))
  } else {
    await updateIntegration(db, tibber.row.id, { meta: rest }, key)
    await notify(db, site.id, 'errors', pulseUpMessage(step.downForMs))
  }
}
