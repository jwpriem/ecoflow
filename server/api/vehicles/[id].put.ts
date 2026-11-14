import { and, eq } from 'drizzle-orm'
import { vehicles } from '../../db/schema'
import { assertExperimental } from '../../services/experimental'
import { getIntegration, updateIntegration } from '../../services/integrations'
import type { AbrpCredentials, AbrpMeta } from '../../services/abrp'
import type { TibberAppMeta } from '../../services/tibberEv'

/**
 * Rename a car, set its usable battery capacity (used later to estimate charging need), or pick
 * which car in the Tibber app it is (tibberVehicleId, null to stop sending its level to Tibber), or set the car's
 * ABRP token (abrpToken, null or '' to stop sending it to ABRP).
 */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const id = Number(getRouterParam(event, 'id'))
  const b = await readBody<{ name?: string; capacityKwh?: number | null; tibberVehicleId?: string | null; abrpToken?: string | null }>(event)
  const update: Partial<typeof vehicles.$inferInsert> = {}
  if (typeof b.name === 'string' && b.name.trim()) update.name = b.name.trim().slice(0, 60)
  if (b.capacityKwh === null) update.capacityKwh = null
  else if (b.capacityKwh !== undefined) {
    const n = Number(b.capacityKwh)
    if (!Number.isFinite(n) || n <= 0 || n > 300) throw createError({ statusCode: 400, statusMessage: 'Bad capacityKwh' })
    update.capacityKwh = n
  }
  const db = useDb()
  const [row] = Object.keys(update).length
    ? await db.update(vehicles).set(update).where(and(eq(vehicles.id, id), eq(vehicles.siteId, site.id))).returning()
    : await db.select().from(vehicles).where(and(eq(vehicles.id, id), eq(vehicles.siteId, site.id)))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Car not found' })

  if (b.tibberVehicleId !== undefined) {
    const key = encryptionKey()
    const integ = await getIntegration(db, site.id, 'tibber_app', key)
    if (!integ) throw createError({ statusCode: 400, statusMessage: 'Tibber app is not connected' })
    const meta = (integ.meta ?? {}) as TibberAppMeta
    const map = { ...(meta.map ?? {}) }
    if (b.tibberVehicleId === null || b.tibberVehicleId === '') delete map[row.id]
    else if (meta.vehicles?.some((v) => v.id === b.tibberVehicleId)) map[row.id] = b.tibberVehicleId
    else throw createError({ statusCode: 400, statusMessage: 'Unknown Tibber car' })
    await updateIntegration(db, integ.row.id, { meta: { ...meta, map } as Record<string, unknown> }, key)
  }

  if (b.abrpToken !== undefined) {
    const key = encryptionKey()
    const integ = await getIntegration<AbrpCredentials>(db, site.id, 'abrp', key)
    if (!integ) throw createError({ statusCode: 400, statusMessage: 'ABRP is not connected' })
    const token = typeof b.abrpToken === 'string' ? b.abrpToken.trim() : ''
    if (token.length > 200) throw createError({ statusCode: 400, statusMessage: 'Bad abrpToken' })
    const tokens = { ...(integ.creds.tokens ?? {}) }
    if (token) tokens[row.id] = token
    else delete tokens[row.id]
    // A new token starts clean: the next reading is sent whatever ABRP had before
    const meta = (integ.meta ?? {}) as AbrpMeta
    const cars = { ...(meta.cars ?? {}) }
    delete cars[row.id]
    await updateIntegration(db, integ.row.id, { creds: { ...integ.creds, tokens }, meta: { ...meta, cars } as Record<string, unknown> }, key)
  }
  return row
})
