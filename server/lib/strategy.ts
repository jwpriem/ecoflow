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
  /** Days for the daily cycle are counted in this timezone */
  timeZone?: string
  /** kWh already discharged today before the first slot, counts toward today's cycle */
  dischargedTodayKwh?: number
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
 * 3. With a daily cycle set, each day that still discharges less than that gets its most expensive
 *    free slots added, covered by stored energy or by the cheapest earlier slots, without the spread
 *    check. A simulated charge level keeps it between reserve and max.
 * 4. Other slots charge from solar only (keep the energy for later), or run self-use when there is
 *    more energy than profitable slots to use it in.
 */
export function buildPlan(input: PlanInput): PlanSlot[] {
  const { prices, cfg } = input
  const eta = cfg.roundTripEfficiency
  const etaIn = Math.sqrt(eta)
  const dischargeKwhPerSlot = (Math.min(input.maxDischargeW, cfg.maxOutputW ?? Infinity, cfg.avgLoadW) * SLOT_H) / 1000
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
  const chargeLeft = new Map<number, number>() // slot index -> kWh still available to buy there
  const chargeUsed = new Map<number, number>() // slot index -> kWh into the batteries there
  if (cfg.gridCharge) {
    let room = Math.max(0, cfg.maxSoc * input.capacityKwh - input.storedKwh)
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
  }

  // 3. Daily cycle
  const cycleKwh = Math.min(cfg.dailyCycleKwh ?? 0, Math.max(0, cfg.maxSoc - cfg.reserveSoc) * input.capacityKwh)
  const cycleCharge = new Set<number>()
  if (cycleKwh > 0) {
    const lo = cfg.reserveSoc * input.capacityKwh
    const hi = cfg.maxSoc * input.capacityKwh
    // Worst shortfall below reserve after a discharge slot, and overshoot above max, along the planned charge level
    const limits = () => {
      let soc = input.storedKwh
      let under = 0
      let over = 0
      for (let i = 0; i < slots.length; i++) {
        soc += chargeUsed.get(i) ?? 0
        if (discharge.has(i)) {
          soc -= dischargeKwhPerSlot
          under = Math.max(under, lo - soc)
        }
        over = Math.max(over, soc - hi)
      }
      return { under, over }
    }
    const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: input.timeZone ?? 'Europe/Amsterdam' }).format(d)
    const days = new Map<string, number[]>()
    slots.forEach((s, i) => {
      const k = dayOf(s.slotStart)
      days.set(k, [...(days.get(k) ?? []), i])
    })
    let first = true
    for (const idx of days.values()) {
      let done = idx.filter((i) => discharge.has(i)).length * dischargeKwhPerSlot + (first ? (input.dischargedTodayKwh ?? 0) : 0)
      first = false
      const free = idx.filter((i) => !discharge.has(i) && !chargeUsed.has(i)).sort((a, b) => slots[b]!.price - slots[a]!.price)
      for (const d of free) {
        if (done >= cycleKwh - 1e-9) break
        if (chargeUsed.has(d)) continue
        const base = limits()
        // The last slot only needs to run until the cycle is full; the batteries stop at reserve by themselves
        const slack = Math.max(0, done + dischargeKwhPerSlot - cycleKwh)
        const short = () => under - base.under - slack
        discharge.add(d)
        const added = new Map<number, number>()
        let { under, over } = limits()
        // Buy the shortfall in the cheapest earlier slots that still fit under max (never dearer than the slot it serves)
        const cheapest = cfg.gridCharge
          ? slots.map((_, c) => c).filter((c) => c < d && !discharge.has(c) && slots[c]!.price < slots[d]!.price).sort((a, b) => slots[a]!.price - slots[b]!.price)
          : []
        for (const c of cheapest) {
          if (short() <= 1e-9) break
          const left = chargeLeft.get(c) ?? chargeKwhPerSlot
          if (left <= 1e-9) continue
          const take = Math.min(left, short())
          chargeUsed.set(c, (chargeUsed.get(c) ?? 0) + take)
          const next = limits()
          if (next.over > base.over + 1e-9) {
            chargeUsed.set(c, chargeUsed.get(c)! - take)
            if (chargeUsed.get(c)! <= 1e-9) chargeUsed.delete(c)
            continue
          }
          chargeLeft.set(c, left - take)
          added.set(c, take)
          ;({ under, over } = next)
        }
        if (short() > 1e-9 || over > base.over + 1e-9) {
          // Not enough cheap room before this slot: undo and try the next most expensive one
          discharge.delete(d)
          for (const [c, take] of added) {
            chargeLeft.set(c, (chargeLeft.get(c) ?? chargeKwhPerSlot) + take)
            chargeUsed.set(c, chargeUsed.get(c)! - take)
            if (chargeUsed.get(c)! <= 1e-9) chargeUsed.delete(c)
          }
          continue
        }
        for (const c of added.keys()) cycleCharge.add(c)
        slots[d]!.action = 'discharge'
        slots[d]!.reason = `daily cycle: one of the day's most expensive slots (€${slots[d]!.price.toFixed(3)})`
        done += dischargeKwhPerSlot
      }
    }
  }

  for (const [c, used] of chargeUsed) {
    const s = slots[c]!
    s.action = 'charge_grid'
    s.targetW = Math.min(input.maxChargeW, Math.ceil((used / SLOT_H / etaIn) * 1000))
    s.reason = cycleCharge.has(c)
      ? `cheapest slot (€${s.price.toFixed(3)}) to fill the daily cycle`
      : `cheap slot (€${s.price.toFixed(3)}) to cover later peaks`
  }

  // 4. Everything else
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
