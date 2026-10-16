import type { BatteryMode, PriceSlot, StrategyConfig } from './types'

export interface PlanInput {
  prices: PriceSlot[] // current slot first, then the future, sorted by time
  storedKwh: number // total over all batteries
  capacityKwh: number
  maxChargeW: number // total over all batteries
  maxDischargeW: number
  /** Average opportunity cost of the energy already in the batteries, EUR/kWh */
  poolAvgCost: number
  cfg: StrategyConfig
}

export interface PlanSlot {
  slotStart: Date
  price: number
  action: BatteryMode
  targetW?: number
  reason: string
}

const SLOT_H = 0.25

/**
 * Rule-based plan over the known price horizon (today + tomorrow once published).
 *
 * 1. Energy already stored goes to the most expensive slots that beat its cost + minSpread.
 * 2. If grid charging is on, more expensive slots are paired with the cheapest earlier slot where
 *    buying, losing (1 - efficiency) and selling later still earns at least minSpread.
 * 3. Other slots charge from solar only (keep the energy for later), or run self-use when there is
 *    more energy than profitable slots to use it in.
 */
export function buildPlan(input: PlanInput): PlanSlot[] {
  const { prices, cfg } = input
  const eta = cfg.roundTripEfficiency
  const etaIn = Math.sqrt(eta)
  const dischargeKwhPerSlot = (Math.min(input.maxDischargeW, cfg.avgLoadW) * SLOT_H) / 1000
  const chargeKwhPerSlot = (input.maxChargeW * SLOT_H * etaIn) / 1000

  const slots: PlanSlot[] = prices.map((p) => ({ slotStart: p.slotStart, price: p.total, action: 'solar_only', reason: '' }))
  if (!slots.length || dischargeKwhPerSlot <= 0) return slots

  const discharge = new Set<number>()
  const byPriceDesc = slots.map((_, i) => i).sort((a, b) => slots[b]!.price - slots[a]!.price)

  // 1. Stored energy
  let usable = Math.max(0, input.storedKwh - cfg.reserveSoc * input.capacityKwh)
  const storedThreshold = input.poolAvgCost + cfg.minSpread
  for (const i of byPriceDesc) {
    if (usable <= 1e-9) break
    if (slots[i]!.price < storedThreshold) break
    discharge.add(i)
    slots[i]!.action = 'discharge'
    slots[i]!.reason = `stored energy (cost €${input.poolAvgCost.toFixed(3)}) sold at peak`
    usable -= dischargeKwhPerSlot
  }
  const surplusStored = usable > 1e-9

  // 2. Grid arbitrage
  if (cfg.gridCharge) {
    let room = Math.max(0, cfg.maxSoc * input.capacityKwh - input.storedKwh)
    const chargeLeft = new Map<number, number>() // slot index -> kWh still available to buy there
    const chargeUsed = new Map<number, number>()
    for (const d of byPriceDesc) {
      if (room <= 1e-9) break
      if (discharge.has(d) || chargeUsed.has(d)) continue
      const pD = slots[d]!.price
      let best = -1
      for (let c = 0; c < d; c++) {
        if (discharge.has(c)) continue
        const left = chargeLeft.get(c) ?? chargeKwhPerSlot
        if (left <= 1e-9) continue
        if (slots[c]!.price / eta + cfg.minSpread > pD) continue
        if (best === -1 || slots[c]!.price < slots[best]!.price) best = c
      }
      if (best === -1) continue
      const need = Math.min(dischargeKwhPerSlot, room)
      const left = chargeLeft.get(best) ?? chargeKwhPerSlot
      const take = Math.min(need, left)
      chargeLeft.set(best, left - take)
      chargeUsed.set(best, (chargeUsed.get(best) ?? 0) + take)
      room -= take
      discharge.add(d)
      slots[d]!.action = 'discharge'
      slots[d]!.reason = `peak €${pD.toFixed(3)}, recharged earlier at €${slots[best]!.price.toFixed(3)}`
    }
    for (const [c, used] of chargeUsed) {
      const s = slots[c]!
      s.action = 'charge_grid'
      s.targetW = Math.min(input.maxChargeW, Math.ceil((used / SLOT_H / etaIn) * 1000))
      s.reason = `cheap slot (€${s.price.toFixed(3)}) to cover later peaks`
    }
  }

  // 3. Everything else
  for (const s of slots) {
    if (s.reason) continue
    if (surplusStored) {
      s.action = 'self_use'
      s.reason = 'more energy stored than profitable peaks'
    } else {
      s.action = 'solar_only'
      s.reason = 'charge from solar, save energy for peaks'
    }
  }
  return slots
}
