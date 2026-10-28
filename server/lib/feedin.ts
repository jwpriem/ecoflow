import { startOfLocalDay } from './time'
import type { StrategyConfig } from './types'

/** The moment netting stops: the start of `nettingUntil` (a yyyy-mm-dd date) in the household's time zone. */
export function nettingEnd(cfg: StrategyConfig['feedIn'], timeZone: string): Date {
  return startOfLocalDay(new Date(`${cfg.nettingUntil.slice(0, 10)}T12:00:00Z`), timeZone)
}

/**
 * What exporting one kWh in this slot would have earned you (EUR/kWh), by the household's own terms. Until the
 * netting date a kWh fed in cancels a kWh bought, so it is worth the full price; after it, a share of the spot
 * price minus the supplier's fee (can go negative when spot prices do).
 */
export function feedInPrice(slotStart: Date, energy: number, total: number, cfg: StrategyConfig['feedIn'], timeZone = 'Europe/Amsterdam'): number {
  if (slotStart < nettingEnd(cfg, timeZone)) return total
  return energy * cfg.factor - cfg.feeEur
}

/** For a slot without a stored price: the spot part isn't known, so the total stands in for it. */
export function fallbackFeedIn(slotStart: Date, total: number, cfg: StrategyConfig['feedIn'], timeZone?: string): number {
  return feedInPrice(slotStart, total, total, cfg, timeZone)
}
