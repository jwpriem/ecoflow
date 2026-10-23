/**
 * Solar ledger: where the solar of one 15-min slot went and what it was worth.
 *
 * SolarEdge has no live feed, only 15-minute averages that arrive late, so the slot is booked afterwards.
 * Everything the panels made in a slot went one of three ways:
 * - into the batteries: the battery ledger's solar charge for that slot
 * - to the grid: the Pulse's export, summed per minute (so a cloud halfway through the slot is fine)
 * - straight into the house: whatever is left
 * Self-used solar is worth the full price (power you did not buy), exported solar the feed-in price.
 * Solar into the batteries is worth the feed-in price you gave up for it; the battery ledger books what
 * it earns on top of that when it comes out again.
 */
import { SLOT_MS, slotStartOf, tzOffsetMs } from './time'

const DAY_MS = 86_400_000
/** SolarEdge keeps adjusting the latest buckets for a while; read those again on every poll */
export const SOLAR_SETTLE_MS = 2 * 3_600_000
/** Furthest back one read goes to fill a gap (one call, one credit); kept short so the API never refuses the span */
export const SOLAR_BACKFILL_MS = DAY_MS

/**
 * Start of the slot a SolarEdge bucket belongs to. Timestamps with an offset or Z are instants;
 * without one (2026-05-01 10:15:00) they are the site's wall-clock time.
 */
export function seBucketStart(timestamp: string, timeZone: string): Date | undefined {
  const iso = timestamp.trim().replace(' ', 'T')
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(iso)) {
    const t = Date.parse(iso)
    return Number.isNaN(t) ? undefined : slotStartOf(t)
  }
  const wall = Date.parse(`${iso}Z`)
  if (Number.isNaN(wall)) return undefined
  // Offset at the wall time itself, then once more at the resulting instant (DST edges)
  const guess = wall - tzOffsetMs(new Date(wall), timeZone)
  return slotStartOf(wall - tzOffsetMs(new Date(guess), timeZone))
}

/** Where the next SolarEdge read starts: the unsettled recent slots, or back to the last slot we have */
export function seReadFrom(now: Date, latestStored: Date | undefined): Date {
  const settle = now.getTime() - SOLAR_SETTLE_MS
  const floor = now.getTime() - SOLAR_BACKFILL_MS
  const from = latestStored ? Math.min(settle, latestStored.getTime()) : floor
  return slotStartOf(Math.max(floor, from))
}

export interface GridMinute {
  dtSec: number
  /** Grid power at the meter, + import */
  gridW: number
}

export interface SolarSlot {
  producedKwh: number
  selfUsedKwh: number
  exportedKwh: number
  toBatteryKwh: number
  valueSelfUsed: number
  valueExported: number
  valueToBattery: number
}

export function bookSolarSlot(input: {
  producedKwh: number
  grid: GridMinute[]
  /** Solar the batteries took in this slot (battery ledger) */
  toBatteryKwh: number
  priceTotal: number
  priceFeedIn: number
}): SolarSlot {
  const produced = Math.max(0, input.producedKwh)
  let exported = 0
  for (const g of input.grid) exported += (Math.max(0, -g.gridW) * g.dtSec) / 3_600_000
  // Export and battery charge can only use what the panels made (a 15-min average against minute readings)
  exported = Math.min(exported, produced)
  const toBattery = Math.min(Math.max(0, input.toBatteryKwh), produced - exported)
  const selfUsed = produced - exported - toBattery
  return {
    producedKwh: produced,
    selfUsedKwh: selfUsed,
    exportedKwh: exported,
    toBatteryKwh: toBattery,
    valueSelfUsed: selfUsed * input.priceTotal,
    valueExported: exported * input.priceFeedIn,
    valueToBattery: toBattery * Math.max(0, input.priceFeedIn),
  }
}

export const slotKwh = (avgW: number) => (avgW * SLOT_MS) / 3_600_000 / 1000
