import { and, desc, eq, gte, inArray, lt, sum } from 'drizzle-orm'
import type { Db } from '../db/client'
import { batteryPool, commandsLog, devices, ledger, plans, type sites } from '../db/schema'
import { planChangeMessage } from '../lib/notifications'
import { idleSurplus, type SurplusState, surplusModes, surplusStep } from '../lib/surplus'
import { buildPlan, type PlanSlot } from '../lib/strategy'
import { addMs, SLOT_MS, slotStartOf, startOfLocalDay } from '../lib/time'
import { defaultStrategy, type BatteryMode } from '../lib/types'
import type { DeviceState } from '../providers/ecoflow'
import { controlEcoFlow, steeringOf } from './ecoflow'
import { getIntegration } from './integrations'
import { getPrices } from './prices'
import { solarForecastW } from './solarForecast'
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
  const storedKwh = devs.reduce((s, d) => s + (((d.state as DeviceState).soc ?? 0) * d.capacityWh) / 1000, 0)
  // Already discharged earlier today, so today's daily cycle only plans the rest
  const [today] = await db
    .select({ kwh: sum(ledger.dischargedKwh) })
    .from(ledger)
    .where(and(eq(ledger.siteId, site.id), gte(ledger.slotStart, startOfLocalDay(now, site.timezone)), lt(ledger.slotStart, from)))

  const solar = await solarForecastW(db, site, from, addMs(from, 48 * 3600_000))

  return buildPlan({
    prices: priceList,
    solarW: priceList.map((p) => solar.get(p.slotStart.getTime()) ?? 0),
    storedKwh,
    capacityKwh: devs.reduce((s, d) => s + d.capacityWh, 0) / 1000,
    maxChargeW: devs.reduce((s, d) => s + d.maxChargeW, 0),
    maxDischargeW: devs.reduce((s, d) => s + d.maxDischargeW, 0),
    poolAvgCost: poolKwh > 0 ? poolCost / poolKwh : 0,
    cfg: { ...defaultStrategy, ...site.strategy },
    timeZone: site.timezone,
    dischargedTodayKwh: Number(today?.kwh ?? 0),
  })
}

type Command = { mode: BatteryMode; powerW?: number; source: string }

/** Solar surplus charging per site, kept in memory: after a restart it starts idle and picks up within minutes */
const surplus = new Map<number, SurplusState>()
export const surplusCharging = (siteId: number) => surplus.get(siteId)?.charging ?? false

const overridden = (site: Site, now: Date) => !!site.override && new Date(site.override.until) > now

/**
 * What the batteries should do right now: manual override wins, then the plan, then plain self-use.
 * A hold or self-use slot turns into charging while the Pulse sees a solar surplus (see lib/surplus).
 */
export function currentCommand(site: Site, plan: PlanSlot[], now: Date, surplusOn = surplusCharging(site.id)): Command {
  if (overridden(site, now)) {
    return { mode: site.override!.mode, powerW: site.override!.powerW, source: 'override' }
  }
  if (site.controlMode === 'manual') return { mode: 'self_use', source: 'manual' }
  const slot = plan.find((p) => p.slotStart.getTime() === slotStartOf(now).getTime())
  if (!slot) return { mode: 'self_use', source: 'no-plan' }
  if (surplusOn && surplusModes.includes(slot.action)) return { mode: 'charge_grid', source: 'solar-surplus' }
  return { mode: slot.action, powerW: slot.targetW, source: 'plan' }
}

export async function runStrategy(db: Db, site: Site, now = new Date(), send?: (mode: BatteryMode) => Promise<string>) {
  const plan = await computePlan(db, site, now)
  const from = slotStartOf(now)
  await db.delete(plans).where(and(eq(plans.siteId, site.id), gte(plans.slotStart, from)))
  if (plan.length) {
    await db.insert(plans).values(
      plan.map((p) => ({ siteId: site.id, slotStart: p.slotStart, action: p.action, targetW: p.targetW ?? null, price: p.price, reason: p.reason })),
    )
  }

  const cmd = currentCommand(site, plan, now)
  const prevMode = await applyCommand(db, site, cmd, now, send)
  // Tell the owner when the plan starts a grid-charge or discharge block (not for their own overrides)
  if (cmd.source === 'plan' && prevMode !== null) {
    const msg = planChangeMessage(plan, now, prevMode, site.timezone)
    if (msg) await notify(db, site.id, 'plan', msg)
  }
  return { plan, command: cmd }
}

/**
 * Send a mode to the batteries when it differs from what they were last told, and log it.
 * Returns the mode of the last command sent before this one (undefined if none), or null without devices.
 */
async function applyCommand(db: Db, site: Site, cmd: Command, now: Date, send?: (mode: BatteryMode) => Promise<string>) {
  const devs = await db.select().from(devices).where(eq(devices.siteId, site.id))
  if (!devs.length) return null
  const from = slotStartOf(now)
  const totalChargeW = devs.reduce((s, d) => s + d.maxChargeW, 0) || 1
  // The last command actually sent, so re-running within a slot (e.g. after a settings change) stays quiet
  const [last] = await recentCommands(db, [devs[0]!.id], 1)
  const prevMode = last?.command as BatteryMode | undefined
  // The STREAM units work as one system: one setting on the main unit steers them all.
  // Monitor only (manual) sends nothing; a failed send is retried on the next run.
  const changed = devs.some((d) => (d.state as DeviceState).mode !== cmd.mode)
  const result = !changed
    ? null
    : cmd.source === 'manual'
      ? 'skipped: monitor only'
      : await (send ?? ((m: BatteryMode) => controlEcoFlow(db, site, encryptionKey(), m)))(cmd.mode)
  if (result !== null) {
    const validUntil = addMs(from, SLOT_MS + 5 * 60_000)
    for (const d of devs) {
      // Split a total power target over the batteries in proportion to their charge power (for the log; the STREAM picks its own power)
      const powerW = cmd.powerW ? Math.round((cmd.powerW * d.maxChargeW) / totalChargeW) : undefined
      const state = d.state as DeviceState
      if (!result.startsWith('error')) {
        await db.update(devices).set({ state: { ...state, mode: cmd.mode, commandW: powerW } as Record<string, unknown> }).where(eq(devices.id, d.id))
      }
      await db.insert(commandsLog).values({ deviceId: d.id, command: cmd.mode, payload: { powerW, source: cmd.source, validUntil: validUntil.toISOString() }, result })
    }
  }
  return prevMode
}

/**
 * Once a minute, from the collector: switch a hold or self-use slot to charging while the Pulse sees a
 * solar surplus, and back. Only when WattsWise steers in auto mode without an override.
 */
export async function runSurplus(
  db: Db,
  site: Site,
  key: string,
  reading: { gridW: number | undefined; batteryW: number; socPct: number; maxChgPct: number },
  now = new Date(),
  send?: (mode: BatteryMode) => Promise<string>,
) {
  const [slot] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.siteId, site.id), eq(plans.slotStart, slotStartOf(now))))
  const devs = await db.select({ maxChargeW: devices.maxChargeW }).from(devices).where(eq(devices.siteId, site.id))
  const ef = devs.length ? await getIntegration(db, site.id, 'ecoflow_official', key) : null
  const eligible =
    !!slot && surplusModes.includes(slot.action) && site.controlMode !== 'manual' && !overridden(site, now) && steeringOf(ef?.meta) === 'wattwise'
  const prev = surplus.get(site.id) ?? idleSurplus()
  const next = surplusStep(prev, {
    gridW: reading.gridW,
    batteryW: reading.batteryW,
    chargeCapW: devs.reduce((s, d) => s + d.maxChargeW, 0),
    socPct: reading.socPct,
    maxPct: Math.min(reading.maxChgPct, site.strategy.maxSoc * 100),
    eligible,
  })
  surplus.set(site.id, next)
  // Outside a hold or self-use slot the 15-minute strategy run owns the batteries
  if (!eligible || next.charging === prev.charging) return { charging: next.charging, streak: next.streak }
  const cmd: Command = next.charging ? { mode: 'charge_grid', source: 'solar-surplus' } : { mode: slot!.action, source: 'plan' }
  await applyCommand(db, site, cmd, now, send)
  return { charging: next.charging, command: cmd.mode }
}

export async function recentCommands(db: Db, deviceIds: number[], limit = 20) {
  if (!deviceIds.length) return []
  return db.select().from(commandsLog).where(inArray(commandsLog.deviceId, deviceIds)).orderBy(desc(commandsLog.ts)).limit(limit)
}
