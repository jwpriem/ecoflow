import { count, eq } from 'drizzle-orm'
import { lightFloors } from '../../../db/schema'
import { checkFloorName, checkPlan, MAX_FLOORS } from '../../../lib/floors'
import { assertExperimental } from '../../../services/experimental'

/** Body: { name, plan? }. A new floor, last in the row */
export default defineEventHandler(async (event) => {
  const { site, experimental } = await requireSite(event)
  assertExperimental(experimental)
  const body = await readBody<{ name?: unknown; plan?: unknown }>(event)
  const db = useDb()
  let name: string
  let plan: string | null
  try {
    name = checkFloorName(body?.name)
    plan = body?.plan === undefined ? null : checkPlan(body.plan)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }
  const [{ n }] = (await db.select({ n: count() }).from(lightFloors).where(eq(lightFloors.siteId, site.id))) as [{ n: number }]
  if (n >= MAX_FLOORS) throw createError({ statusCode: 400, statusMessage: `At most ${MAX_FLOORS} floors` })
  const [row] = await db.insert(lightFloors).values({ siteId: site.id, name, plan, sort: n }).returning({ id: lightFloors.id })
  return { id: row!.id }
})
