/**
 * Solar surplus charging without a meter on the STREAM.
 *
 * The STREAM units have no smart meter of their own, so in Self-Powered mode they never see that the
 * house is exporting and do not store the surplus. The Tibber Pulse does see it. When the plan says
 * hold (solar_only) or self-use, this switches the batteries to charging while there is a clear
 * surplus, and back when they mostly charge from the grid. The STREAM picks its own charge power
 * (about 1 kW per unit), so this is on/off with a margin, not a match to the surplus:
 * - start after START_MINUTES in a row of export >= half the combined charge power
 * - stop after STOP_MINUTES in a row where more than half of the charge power comes from the grid
 * - stop at once when the batteries are full or the plan, an override or monitor-only takes over
 */
import type { BatteryMode } from './types'

export const START_MINUTES = 3
export const STOP_MINUTES = 3
/** Stop this close to the charge limit, so the last percent is not chased with grid power */
export const FULL_MARGIN_PCT = 1

export interface SurplusState {
  charging: boolean
  /** Consecutive minutes the start (when idle) or stop (when charging) condition held */
  streak: number
}

export const idleSurplus = (): SurplusState => ({ charging: false, streak: 0 })

/** Plan modes in which surplus charging may step in */
export const surplusModes: BatteryMode[] = ['solar_only', 'self_use']

export function surplusStep(
  st: SurplusState,
  input: {
    /** Grid power at the meter with the batteries running, + import; undefined when the Pulse is quiet */
    gridW: number | undefined
    /** Combined AC power of the batteries, + charging */
    batteryW: number
    /** Combined charge power the batteries take in charge mode */
    chargeCapW: number
    socPct: number
    maxPct: number
    /** The plan holds or self-uses, WattsWise steers and nothing overrides it */
    eligible: boolean
  },
): SurplusState {
  if (!input.eligible || input.socPct >= input.maxPct - FULL_MARGIN_PCT) return idleSurplus()
  if (input.gridW === undefined) return st
  if (!st.charging) {
    const exportW = -input.gridW
    const streak = exportW >= input.chargeCapW / 2 ? st.streak + 1 : 0
    return streak >= START_MINUTES ? { charging: true, streak: 0 } : { charging: false, streak }
  }
  const chargeW = Math.max(0, input.batteryW)
  const fromGrid = input.gridW > Math.max(chargeW, input.chargeCapW / 4) / 2
  const streak = fromGrid ? st.streak + 1 : 0
  return streak >= STOP_MINUTES ? idleSurplus() : { charging: true, streak }
}
