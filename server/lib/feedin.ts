import type { StrategyConfig } from './types'

/** What exporting one kWh in this slot would have earned you (EUR/kWh). */
export function feedInPrice(slotStart: Date, energy: number, total: number, cfg: StrategyConfig['feedIn']): number {
  if (slotStart < new Date(cfg.nettingUntil)) return total
  return energy * cfg.factor - cfg.feeEur
}
