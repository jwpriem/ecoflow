import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { devices, plans } from '../../db/schema'
import { addMs, startOfLocalDay } from '../../lib/time'
import { getPrices } from '../../services/prices'
import { recentCommands } from '../../services/strategy'

/** Prices for today + tomorrow with the planned action per slot */
export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const db = useDb()
  const from = startOfLocalDay(new Date(), site.timezone)
  const to = addMs(from, 48 * 3600_000)
  const [priceList, planRows, devs] = await Promise.all([
    getPrices(db, site.id, from, to),
    db.select().from(plans).where(and(eq(plans.siteId, site.id), gte(plans.slotStart, from), lt(plans.slotStart, to))).orderBy(asc(plans.slotStart)),
    db.select({ id: devices.id }).from(devices).where(eq(devices.siteId, site.id)),
  ])
  const planBySlot = new Map(planRows.map((p) => [p.slotStart.getTime(), p]))
  return {
    controlMode: site.controlMode,
    override: site.override,
    strategy: site.strategy,
    slots: priceList.map((p) => {
      const plan = planBySlot.get(p.slotStart.getTime())
      return { slotStart: p.slotStart, total: p.total, feedIn: p.feedIn, source: p.source, action: plan?.action ?? null, targetW: plan?.targetW ?? null, reason: plan?.reason ?? null }
    }),
    commands: await recentCommands(db, devs.map((d) => d.id)),
  }
})
