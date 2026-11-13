import { integrations } from '../../db/schema'
import { and, eq } from 'drizzle-orm'
import { assertExperimental } from '../../services/experimental'
import { hueHttpError, readHueScenes } from '../../services/hue'

/**
 * The scenes from the Hue app. Apart from the lamps (/api/lights), which the Lights tab reads every few seconds:
 * scenes rarely change, so the tab asks for them far less often.
 */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const db = useDb()
  const [row] = await db.select().from(integrations).where(and(eq(integrations.siteId, site.id), eq(integrations.provider, 'hue')))
  if (!row?.meta.authorized) return { scenes: [] }
  try {
    return { scenes: await readHueScenes(db, site, encryptionKey()) }
  } catch (err) {
    hueHttpError(err)
  }
})
