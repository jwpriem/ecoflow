import { and, eq } from 'drizzle-orm'
import { integrations } from '../../db/schema'
import { assertExperimental } from '../../services/experimental'
import { nestHttpError, readCameras } from '../../services/nest'

/** The Security tab: the Nest cameras shared with WattsWise, or why there are none (not connected, not signed in) */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const db = useDb()
  const [row] = await db.select().from(integrations).where(and(eq(integrations.siteId, site.id), eq(integrations.provider, 'nest')))
  if (!row) return { connected: false, signedIn: false, cameras: [] }
  if (!row.meta.authorized) return { connected: true, signedIn: false, cameras: [] }
  try {
    return { connected: true, signedIn: true, cameras: await readCameras(db, site, encryptionKey()) }
  } catch (err) {
    nestHttpError(err)
  }
})
