import { SLOT_MS } from './time'

/** Minute samples are kept this long; older ones become one 15-min average per battery, meter and solar */
export const RAW_DAYS = 60
/** Days thinned per run at most, so the first run after a long gap doesn't hold the database for long */
export const MAX_DAYS_PER_RUN = 31
const DAY_MS = 86_400_000

/**
 * Samples before this moment may be thinned: older than RAW_DAYS, and already booked by the battery
 * ledger (it continues from each battery's next slot, which must still find its minutes). On a day boundary.
 */
export function thinUntil(now: Date, nextSlots: Date[]): Date {
  const limit = Math.min(now.getTime() - RAW_DAYS * DAY_MS, ...nextSlots.map((d) => d.getTime() - DAY_MS))
  return new Date(Math.floor(limit / DAY_MS) * DAY_MS)
}

/** Averaged rows sit exactly on a slot start; a minute sample practically never does */
export function isThinned(ts: Date): boolean {
  return ts.getTime() % SLOT_MS === 0
}
