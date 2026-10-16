import type { Db } from '../db/client'
import type { sites } from '../db/schema'
import type { TibberCredentials } from '../providers/tibber'
import { startPulse, stopPulse } from '../providers/tibberPulse'
import { getIntegration } from './integrations'

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
