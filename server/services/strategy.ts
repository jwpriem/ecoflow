import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { batteryPool, commandsLog, devices, plans, type sites } from '../db/schema'
import type { SimState } from '../lib/simulator'
import { planChangeMessage } from '../lib/notifications'
import { buildPlan, type PlanSlot } from '../lib/strategy'
import { addMs, SLOT_MS, slotStartOf } from '../lib/time'
import type { BatteryMode } from '../lib/types'
import { mockDriver } from '../providers/ecoflow'
import { getPrices } from './prices'
import { notify } from './push'

type Site = typeof sites.$inferSelect

export async function computePlan(db: Db, site: Site, now = new Date()): Promise<PlanSlot[]> {
  const from = slotStartOf(now)
  const priceList = await getPrices(db, site.id, from, addMs(from, 48 * 3600_000))
  const devs = await db.select().from(devices).where(eq(devices.siteId, site.id))
  const pools = devs.length
    ? await db.select().from(batteryPool).where(inArray(batteryPool.deviceId, devs.map((d) => d.id)))
    : []
  const poolKwh = pools.reduce((s, p) => s + p.kwh, 0)
  const poolCost = pools.reduce((s, p) => s + p.costOpportunity, 0)
  const storedKwh = devs.reduce((s, d) => s + (((d.state as unknown as SimState).soc ?? 0) * d.capacityWh) / 1000, 0)

  return buildPlan({
    prices: priceList,
    storedKwh,
    capacityKwh: devs.reduce((s, d) => s + d.capacityWh, 0) / 1000,
    maxChargeW: devs.reduce((s, d) => s + d.maxChargeW, 0),
    maxDischargeW: devs.reduce((s, d) => s + d.maxDischargeW, 0),
    poolAvgCost: poolKwh > 0 ? poolCost / poolKwh : 0,
    cfg: site.strategy,
  })
}

/** What the batteries should do right now: manual override wins, then the plan, then plain self-use. */
export function currentCommand(site: Site, plan: PlanSlot[], now: Date): { mode: BatteryMode; powerW?: number; source: string } {
  if (site.override && new Date(site.override.until) > now) {
    return { mode: site.override.mode, powerW: site.override.powerW, source: 'override' }
  }
  if (site.controlMode === 'manual') return { mode: 'self_use', source: 'manual' }
  const slot = plan.find((p) => p.slotStart.getTime() === slotStartOf(now).getTime())
  if (!slot) return { mode: 'self_use', source: 'no-plan' }
  return { mode: slot.action, powerW: slot.targetW, source: 'plan' }
}

export async function runStrategy(db: Db, site: Site, now = new Date()) {
  const plan = await computePlan(db, site, now)
  const from = slotStartOf(now)
  await db.delete(plans).where(and(eq(plans.siteId, site.id), gte(plans.slotStart, from)))
  if (plan.length) {
    await db.insert(plans).values(
      plan.map((p) => ({ siteId: site.id, slotStart: p.slotStart, action: p.action, targetW: p.targetW ?? null, price: p.price, reason: p.reason })),
    )
  }

  const cmd = currentCommand(site, plan, now)
  const devs = await db.select().from(devices).where(eq(devices.siteId, site.id))
  const totalChargeW = devs.reduce((s, d) => s + d.maxChargeW, 0) || 1
  // The last command actually sent, so re-running within a slot (e.g. after a settings change) stays quiet
  const [last] = devs.length ? await recentCommands(db, [devs[0]!.id], 1) : []
  const prevMode = last?.command as BatteryMode | undefined
  for (const d of devs) {
    // Split a total power target over the batteries in proportion to their charge power
    const powerW = cmd.powerW ? Math.round((cmd.powerW * d.maxChargeW) / totalChargeW) : undefined
    const state = d.state as unknown as SimState
    if (state.mode === cmd.mode && state.commandW === powerW) continue
    const validUntil = addMs(from, SLOT_MS + 5 * 60_000)
    let result = 'ok'
    if (d.driver === 'mock') {
      const next = mockDriver.apply(state.ts ? state : mockDriver.initialState(now), { mode: cmd.mode, powerW, validUntil })
      await db.update(devices).set({ state: next as unknown as Record<string, unknown> }).where(eq(devices.id, d.id))
    } else {
      result = 'skipped: real EcoFlow control not implemented yet'
    }
    await db.insert(commandsLog).values({ deviceId: d.id, command: cmd.mode, payload: { powerW, source: cmd.source, validUntil: validUntil.toISOString() }, result })
  }
  // Tell the owner when the plan starts a grid-charge or discharge block (not for their own overrides)
  if (cmd.source === 'plan' && devs.length) {
    const msg = planChangeMessage(plan, now, prevMode, site.timezone)
    if (msg) await notify(db, site.id, 'plan', msg)
  }
  return { plan, command: cmd }
}

export async function recentCommands(db: Db, deviceIds: number[], limit = 20) {
  if (!deviceIds.length) return []
  return db.select().from(commandsLog).where(inArray(commandsLog.deviceId, deviceIds)).orderBy(desc(commandsLog.ts)).limit(limit)
}
