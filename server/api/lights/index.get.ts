import { integrations } from '../../db/schema'
import { and, eq } from 'drizzle-orm'
import { assertExperimental } from '../../services/experimental'
import { hueHttpError, readHue } from '../../services/hue'

/** The Lights tab: every Hue lamp, room and zone, or why there are none (not connected, not signed in) */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const db = useDb()
  const [row] = await db.select().from(integrations).where(and(eq(integrations.siteId, site.id), eq(integrations.provider, 'hue')))
  if (!row) return { connected: false, signedIn: false, lights: [], groups: [] }
  if (!row.meta.authorized) return { connected: true, signedIn: false, lights: [], groups: [] }
  try {
    const state = await readHue(db, site, encryptionKey())
    return { connected: true, signedIn: true, ...state }
  } catch (err) {
    hueHttpError(err)
  }
})
