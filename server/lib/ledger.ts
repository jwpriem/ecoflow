/**
 * Savings ledger: books one battery for one 15-min slot.
 *
 * - Charging is attributed to solar or grid: whatever the batteries charged that was not imported
 *   from the grid at that moment came from solar surplus. Direct PV input is always solar.
 * - Each battery keeps a pool (kWh + what they cost). Charging adds to it; discharging takes energy out
 *   at the pool's average cost. Two costs are tracked: naive (solar = 0) and opportunity (solar = feed-in price).
 * - After each slot the pool is reconciled to the measured SoC. Lost kWh disappear but their cost stays,
 *   so round-trip losses show up as a higher cost per kWh.
 * - lossKwh is signed: a slot where the SoC reads higher than booked gives a negative loss. SoC readings are
 *   noisy (whole percents, lag behind the power readings), so counting only the drops books that noise as loss.
 *   Signed, the sum over any period is charged - discharged - change in stored energy.
 */

export interface Pool {
  kwh: number
  costNaive: number
  costOpportunity: number
}

export interface LedgerSample {
  dtSec: number
  /** This battery's AC power, + charging */
  batteryW: number
  /** This battery's direct PV input */
  pvW: number
  /** Sum of AC charging power of all batteries at this moment (>= 0) */
  totalChargeW: number
  /** Grid power at the meter with the batteries running, + import */
  gridW: number
}

export interface SlotResult {
  chargedSolarKwh: number
  chargedGridKwh: number
  dischargedKwh: number
  costNaive: number
  costOpportunity: number
  valueDischarged: number
  savingNaive: number
  savingOpportunity: number
  lossKwh: number
  pool: Pool
}

const kwh = (w: number, dtSec: number) => (w * dtSec) / 3600 / 1000

export function attribute(samples: LedgerSample[]) {
  let solar = 0
  let grid = 0
  let discharged = 0
  for (const s of samples) {
    const chargeW = Math.max(0, s.batteryW)
    let gridPartW = 0
    if (chargeW > 0 && s.totalChargeW > 0) {
      gridPartW = Math.min(s.totalChargeW, Math.max(0, s.gridW)) * (chargeW / s.totalChargeW)
    }
    grid += kwh(gridPartW, s.dtSec)
    solar += kwh(chargeW - gridPartW, s.dtSec) + kwh(Math.max(0, s.pvW), s.dtSec)
    discharged += kwh(Math.max(0, -s.batteryW), s.dtSec)
  }
  return { solar, grid, discharged }
}

export function bookSlot(input: {
  pool: Pool
  samples: LedgerSample[]
  priceTotal: number
  priceFeedIn: number
  /** Measured stored energy at the end of the slot (SoC x capacity), kWh. Omit to skip reconciliation. */
  measuredKwh?: number
}): SlotResult {
  const { solar, grid, discharged } = attribute(input.samples)
  const costNaive = grid * input.priceTotal
  const costOpportunity = grid * input.priceTotal + solar * Math.max(0, input.priceFeedIn)

  const pool: Pool = {
    kwh: input.pool.kwh + solar + grid,
    costNaive: input.pool.costNaive + costNaive,
    costOpportunity: input.pool.costOpportunity + costOpportunity,
  }

  let outNaive = 0
  let outOpp = 0
  if (discharged > 0 && pool.kwh > 0) {
    const share = Math.min(1, discharged / pool.kwh)
    outNaive = pool.costNaive * share
    outOpp = pool.costOpportunity * share
    pool.kwh = Math.max(0, pool.kwh - discharged)
    pool.costNaive -= outNaive
    pool.costOpportunity -= outOpp
  }

  let lossKwh = 0
  if (input.measuredKwh !== undefined) {
    lossKwh = pool.kwh - input.measuredKwh
    pool.kwh = Math.max(0, input.measuredKwh)
  }

  const valueDischarged = discharged * input.priceTotal
  return {
    chargedSolarKwh: solar,
    chargedGridKwh: grid,
    dischargedKwh: discharged,
    costNaive,
    costOpportunity,
    valueDischarged,
    savingNaive: valueDischarged - outNaive,
    savingOpportunity: valueDischarged - outOpp,
    lossKwh,
    pool,
  }
}
