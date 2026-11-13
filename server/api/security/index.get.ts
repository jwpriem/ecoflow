import { eq } from 'drizzle-orm'
import { integrations } from '../../db/schema'
import { lastRing } from '../../lib/nest'
import { assertExperimental } from '../../services/experimental'
import { nestHttpError, readCameras } from '../../services/nest'

/** The Security tab: the Nest cameras shared with WattsWise, or why there are none (not connected, not signed in) */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const db = useDb()
  const rows = await db.select().from(integrations).where(eq(integrations.siteId, site.id))
  const row = rows.find((r) => r.provider === 'nest')
  if (!row) return { connected: false, signedIn: false, cameras: [] }
  if (!row.meta.authorized) return { connected: true, signedIn: false, cameras: [] }
  try {
    return {
      connected: true,
      signedIn: true,
      cameras: await readCameras(db, site, encryptionKey()),
      // When the bell last rang, and whether a speaker can play it (its settings are then in Settings)
      lastRing: lastRing(row.meta),
      chime: !!rows.find((r) => r.provider === 'sonos')?.meta.authorized,
    }
  } catch (err) {
    nestHttpError(err)
  }
})
