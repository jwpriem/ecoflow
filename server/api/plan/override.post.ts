import { eq } from 'drizzle-orm'
import { sites } from '../../db/schema'
import type { BatteryMode } from '../../lib/types'
import { runStrategy } from '../../services/strategy'

const MODES: BatteryMode[] = ['self_use', 'solar_only', 'charge_grid', 'discharge']

/** Body: { mode, minutes, powerW? } to override, or { clear: true } */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const body = await readBody<{ mode?: BatteryMode; minutes?: number; powerW?: number; clear?: boolean; controlMode?: 'auto' | 'manual' }>(event)
  const update: Partial<typeof sites.$inferInsert> = {}
  if (body.controlMode === 'auto' || body.controlMode === 'manual') update.controlMode = body.controlMode
  if (body.clear) update.override = null
  else if (body.mode) {
    if (!MODES.includes(body.mode)) throw createError({ statusCode: 400, statusMessage: 'Unknown mode' })
    const minutes = Math.min(24 * 60, Math.max(5, Number(body.minutes) || 60))
    update.override = { mode: body.mode, until: new Date(Date.now() + minutes * 60_000).toISOString(), powerW: body.powerW ? Number(body.powerW) : undefined }
  }
  const [updated] = await useDb().update(sites).set(update).where(eq(sites.id, site.id)).returning()
  const result = await runStrategy(useDb(), updated!)
  return { override: updated!.override, controlMode: updated!.controlMode, command: result.command }
})
