import type { BatteryMode } from './types'

export interface ForecastSlot {
  slotStart: Date
  action: BatteryMode
  targetW?: number | null
  /** Expected solar production, W */
  solarW?: number
}

export interface ForecastPoint {
  ts: Date
  soc: number
  action: BatteryMode
}

/**
 * Rough combined state-of-charge path that follows the plan, for the app's charge curve.
 * Grid charging and discharging follow the plan; in self-use and solar-only slots the expected
 * solar beyond the average house load goes in, otherwise they hold the level. Returns one point at the end of each slot,
 * starting with the current level at the first slot's start.
 */
export function projectSoc(
  startSoc: number,
  slots: ForecastSlot[],
  opts: { capacityWh: number; maxChargeW: number; maxDischargeW: number; avgLoadW: number; reserveSoc: number; maxSoc: number; legEfficiency: number },
): ForecastPoint[] {
  if (!slots.length || opts.capacityWh <= 0) return []
  const out: ForecastPoint[] = [{ ts: slots[0]!.slotStart, soc: startSoc, action: slots[0]!.action }]
  let soc = startSoc
  for (const s of slots) {
    let wh = 0
    if (s.action === 'charge_grid') wh = (s.targetW || opts.maxChargeW) * 0.25 * opts.legEfficiency
    else if (s.action === 'discharge') wh = -((s.targetW || Math.min(opts.avgLoadW, opts.maxDischargeW)) * 0.25) / opts.legEfficiency
    else if (s.solarW) wh = Math.min(opts.maxChargeW, Math.max(0, s.solarW - opts.avgLoadW)) * 0.25 * opts.legEfficiency
    const next = soc + wh / opts.capacityWh
    if (wh > 0) soc = Math.max(soc, Math.min(opts.maxSoc, next))
    else if (wh < 0) soc = Math.min(soc, Math.max(opts.reserveSoc, next))
    out.push({ ts: new Date(s.slotStart.getTime() + 15 * 60_000), soc, action: s.action })
  }
  return out
}
