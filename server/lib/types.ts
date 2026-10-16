export type BatteryMode = 'self_use' | 'solar_only' | 'charge_grid' | 'discharge'

export interface StrategyConfig {
  /** Never discharge below this SoC (0-1) */
  reserveSoc: number
  /** Never charge above this SoC (0-1) */
  maxSoc: number
  /** Round-trip efficiency, e.g. 0.85 */
  roundTripEfficiency: number
  /** Minimum EUR/kWh profit before we bother cycling the battery */
  minSpread: number
  /** Allow charging from the grid in cheap slots */
  gridCharge: boolean
  /** Typical household load while discharging, W (the Stream follows the load, it does not export) */
  avgLoadW: number
  /** How solar you store is valued when you could have exported it instead */
  feedIn: {
    /** Until this date (exclusive) exported kWh are netted at the full price (saldering) */
    nettingUntil: string
    /** After netting: feed-in = energy (spot) price * factor - fee */
    factor: number
    feeEur: number
  }
  /** Used when no price is known for a slot */
  fallbackPrice: number
}

export const defaultStrategy: StrategyConfig = {
  reserveSoc: 0.1,
  maxSoc: 1,
  roundTripEfficiency: 0.85,
  minSpread: 0.03,
  gridCharge: true,
  avgLoadW: 450,
  feedIn: { nettingUntil: '2027-01-01', factor: 1, feeEur: 0 },
  fallbackPrice: 0.25,
}

export interface Override {
  mode: BatteryMode
  until: string // ISO
  powerW?: number
}

export interface PriceSlot {
  slotStart: Date
  total: number
  energy: number
  feedIn: number
}
