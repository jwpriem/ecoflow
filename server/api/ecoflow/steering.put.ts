import { eq } from 'drizzle-orm'
import { devices } from '../../db/schema'
import type { DeviceState } from '../../providers/ecoflow'
import { type EcoFlowSteering, setEcoFlowSteering } from '../../services/ecoflow'
import { runStrategy } from '../../services/strategy'

/** Body: { steering: 'ecoflow_ai' | 'wattwise' }. Switches the STREAM's operating mode right away. */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const { steering } = await readBody<{ steering?: EcoFlowSteering }>(event)
  if (steering !== 'ecoflow_ai' && steering !== 'wattwise') throw createError({ statusCode: 400, statusMessage: 'steering must be ecoflow_ai or wattwise' })
  const db = useDb()
  const error = await setEcoFlowSteering(db, site, encryptionKey(), steering)
  if (error) throw createError({ statusCode: 502, statusMessage: `EcoFlow: ${error}` })
  // Forget the last sent mode so the current plan slot goes out now instead of at the next change
  for (const d of await db.select().from(devices).where(eq(devices.siteId, site.id))) {
    const { mode: _mode, commandW: _w, ...state } = d.state as DeviceState
    await db.update(devices).set({ state: state as Record<string, unknown> }).where(eq(devices.id, d.id))
  }
  const result = await runStrategy(db, site)
  return { steering, command: result.command }
})
