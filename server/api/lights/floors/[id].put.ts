import { and, eq } from 'drizzle-orm'
import { lightFloors } from '../../../db/schema'
import { checkFloorName, checkPlacements, checkPlan } from '../../../lib/floors'
import { assertExperimental } from '../../../services/experimental'

/** Body: any of { name, plan, placements, sort } */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const id = Number(getRouterParam(event, 'id'))
  const body = await readBody<Record<string, unknown>>(event)
  const set: Partial<typeof lightFloors.$inferInsert> = {}
  try {
    if (body?.name !== undefined) set.name = checkFloorName(body.name)
    if (body?.plan !== undefined) set.plan = checkPlan(body.plan)
    if (body?.placements !== undefined) set.placements = checkPlacements(body.placements)
    if (body?.sort !== undefined) set.sort = Math.max(0, Math.min(100, Math.round(Number(body.sort)) || 0))
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
  if (!Object.keys(set).length) throw createError({ statusCode: 400, statusMessage: 'Nothing to change' })
  const [row] = await useDb()
    .update(lightFloors)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(lightFloors.id, id), eq(lightFloors.siteId, site.id)))
    .returning({ id: lightFloors.id })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Floor not found' })
  return { ok: true }
})
