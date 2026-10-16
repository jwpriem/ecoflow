import type { BatteryMode } from '../../lib/types'
import { simulateStep, type SimLimits, type SimState } from '../../lib/simulator'
import type { devices } from '../../db/schema'

export type DeviceRow = typeof devices.$inferSelect

export interface BatteryCommand {
  mode: BatteryMode
  powerW?: number
  validUntil: Date
}

/**
 * Simulated STREAM Pro. Its state lives in devices.state so it survives restarts.
 * houseNetW is the household's net power without batteries (+ import), taken from the Tibber Pulse,
 * SolarEdge or a synthetic profile.
 */
export const mockDriver = {
  initialState(now: Date): SimState {
    return { soc: 0.5, mode: 'self_use', powerW: 0, pvW: 0, ts: now.toISOString() }
  },

  step(rows: DeviceRow[], houseNetW: number, now: Date, limits: SimLimits): SimState[] {
    const items = rows.map((device) => {
      const state = (device.state as unknown as SimState)?.ts ? (device.state as unknown as SimState) : this.initialState(now)
      return { device, state }
    })
    // Use the elapsed time since the last state, capped so a long downtime does not jump the SoC
    const lastTs = Math.max(...items.map((i) => new Date(i.state.ts).getTime()))
    const dtSec = Math.min(300, Math.max(0, (now.getTime() - lastTs) / 1000)) || 60
    return simulateStep(items, houseNetW, dtSec, limits, now)
  },

  apply(state: SimState, cmd: BatteryCommand): SimState {
    return { ...state, mode: cmd.mode, commandW: cmd.powerW }
  },
}

/**
 * Real EcoFlow drivers. Phase 0 (see docs/plans) has to prove which commands work on the STREAM Pro.
 * - ecoflow_official: IoT Open API (access key + secret key, HMAC-SHA256), good for reading.
 * - ecoflow_app: app account login -> MQTT credentials -> protobuf set messages, needed for control.
 */
export function realDriverNotReady(driver: string): never {
  throw new Error(`EcoFlow driver "${driver}" is not implemented yet; use the mock driver for now`)
}
