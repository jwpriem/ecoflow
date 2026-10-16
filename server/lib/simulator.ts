import type { BatteryMode } from './types'

/** Simulated STREAM Pro. Used until the real EcoFlow driver is wired up. */
export interface SimDevice {
  id: number
  capacityWh: number
  maxChargeW: number
  maxDischargeW: number
}

export interface SimState {
  soc: number // 0-1
  mode: BatteryMode
  /** Optional fixed power for charge_grid / discharge */
  commandW?: number
  powerW: number // last AC power, + charging
  pvW: number // direct PV input (none for the simulation)
  ts: string // ISO time of this state
}

export interface SimLimits {
  reserveSoc: number
  maxSoc: number
  /** One-way efficiency (charge and discharge each) */
  legEfficiency: number
}

/**
 * Advance all batteries by dtSec.
 * houseNetW = household consumption minus solar production *without* the batteries (+ import, - surplus).
 * Returns the new states; the grid power with batteries is houseNetW + sum(powerW).
 */
export function simulateStep(
  devices: { device: SimDevice; state: SimState }[],
  houseNetW: number,
  dtSec: number,
  limits: SimLimits,
  now: Date,
): SimState[] {
  const totalCap = devices.reduce((s, d) => s + d.device.capacityWh, 0) || 1
  const dtH = dtSec / 3600
  const eta = limits.legEfficiency

  return devices.map(({ device, state }) => {
    const share = houseNetW * (device.capacityWh / totalCap)
    let target: number
    switch (state.mode) {
      case 'self_use':
        target = -share
        break
      case 'solar_only':
        target = Math.max(0, -share)
        break
      case 'charge_grid':
        target = state.commandW ?? device.maxChargeW
        break
      case 'discharge':
        target = state.commandW ? -state.commandW : -share
        break
    }

    const headroomW = dtH > 0 ? ((limits.maxSoc - state.soc) * device.capacityWh) / dtH / eta : 0
    const availableW = dtH > 0 ? ((state.soc - limits.reserveSoc) * device.capacityWh * eta) / dtH : 0
    let p = target
    if (p > 0) p = Math.max(0, Math.min(p, device.maxChargeW, headroomW))
    else if (p < 0) p = Math.min(0, Math.max(p, -device.maxDischargeW, -availableW))

    const dSoc = p >= 0 ? (p * dtH * eta) / device.capacityWh : (p * dtH) / eta / device.capacityWh
    const soc = Math.min(1, Math.max(0, state.soc + dSoc))
    return { ...state, soc, powerW: Math.round(p) || 0, pvW: 0, ts: now.toISOString() }
  })
}
