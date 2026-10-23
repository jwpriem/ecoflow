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
  /** Expected solar production per slot in W, same order as prices; missing = no sun expected */
  solarW?: number[]
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
 * 2. More expensive slots are paired with the cheapest earlier source where buying, losing
 *    (1 - efficiency) and selling later still earns at least minSpread: the grid (if grid charging is on)
 *    or the solar surplus the forecast expects, valued at the feed-in price it would otherwise earn.
 * 3. With a daily cycle set, each day that still discharges less than that gets its most expensive
 *    free slots added, covered by stored energy, expected solar or the cheapest earlier slots, without
 *    the spread check. A simulated charge level keeps it between reserve and max.
 * 4. Other slots charge from solar only (keep the energy for later), or run self-use when there is
 *    more energy than profitable slots to use it in.
 */
export function buildPlan(input: PlanInput): PlanSlot[] {
  const { prices, cfg } = input
  const eta = cfg.roundTripEfficiency
  const etaIn = Math.sqrt(eta)
  const dischargeKwhPerSlot = (Math.min(input.maxDischargeW, cfg.maxOutputW ?? Infinity, cfg.avgLoadW) * SLOT_H) / 1000
  const chargeKwhPerSlot = (input.maxChargeW * SLOT_H * etaIn) / 1000
  // Solar beyond the house load goes into the batteries by itself in a hold or self-use slot (services/strategy runSurplus)
  const solarIn = prices.map((_, i) => (Math.min(input.maxChargeW, Math.max(0, (input.solarW?.[i] ?? 0) - cfg.avgLoadW)) * SLOT_H * etaIn) / 1000)

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
  // Only worth self-use when at least one slot's worth is left; a few Wh above the reserve is just rounding
  const surplusStored = usable >= dischargeKwhPerSlot / 2

  // 2. Arbitrage: fill each expensive slot from the cheapest earlier source, the grid at its price or
  // expected solar at the feed-in price it would otherwise earn
  const chargeLeft = new Map<number, number>() // slot index -> kWh still available to buy there
  const chargeUsed = new Map<number, number>() // slot index -> kWh into the batteries there
  const solarLeft = new Map<number, number>() // slot index -> expected solar kWh not yet assigned to a peak
  const solarCost = (i: number) => Math.max(0, prices[i]!.feedIn)
  let room = Math.max(0, cfg.maxSoc * input.capacityKwh - input.storedKwh)
  for (const d of byPriceDesc) {
    if (room <= 1e-9) break
    if (discharge.has(d) || chargeUsed.has(d)) continue
    const pD = slots[d]!.price
    let best = -1
    let bestSolar = false
    let bestCost = Infinity
    for (let c = 0; c < d; c++) {
      if (discharge.has(c)) continue
      if ((solarLeft.get(c) ?? solarIn[c]!) > 1e-9 && solarCost(c) < bestCost && solarCost(c) / eta + cfg.minSpread <= pD) {
        best = c
        bestSolar = true
        bestCost = solarCost(c)
      }
      if (!cfg.gridCharge || (chargeLeft.get(c) ?? chargeKwhPerSlot) <= 1e-9) continue
      if (slots[c]!.price / eta + cfg.minSpread > pD) continue
      if (slots[c]!.price < bestCost) {
        best = c
        bestSolar = false
        bestCost = slots[c]!.price
      }
    }
    if (best === -1) continue
    const need = Math.min(dischargeKwhPerSlot, room)
    const pool = bestSolar ? solarLeft : chargeLeft
    const left = pool.get(best) ?? (bestSolar ? solarIn[best]! : chargeKwhPerSlot)
    const take = Math.min(need, left)
    pool.set(best, left - take)
    if (bestSolar) {
      slots[best]!.reason ||= `store solar (worth €${solarCost(best).toFixed(3)} fed in) for a later peak`
    } else {
      chargeUsed.set(best, (chargeUsed.get(best) ?? 0) + take)
    }
    room -= take
    discharge.add(d)
    slots[d]!.action = 'discharge'
    slots[d]!.reason = bestSolar
      ? `peak €${pD.toFixed(3)}, filled with solar earlier`
      : `peak €${pD.toFixed(3)}, recharged earlier at €${slots[best]!.price.toFixed(3)}`
  }

  // 3. Daily cycle
  const cycleKwh = Math.min(cfg.dailyCycleKwh ?? 0, Math.max(0, cfg.maxSoc - cfg.reserveSoc) * input.capacityKwh)
  const cycleCharge = new Set<number>()
  if (cycleKwh > 0) {
    const lo = cfg.reserveSoc * input.capacityKwh
    const hi = cfg.maxSoc * input.capacityKwh
    // Worst shortfall below reserve after a discharge slot (and where), and overshoot above max, along the planned charge level
    const limits = () => {
      let soc = input.storedKwh
      let under = 0
      let at = -1
      let over = 0
      for (let i = 0; i < slots.length; i++) {
        soc += chargeUsed.get(i) ?? 0
        // Solar only fills what room is left; the rest goes to the grid, so it never overshoots
        if (!discharge.has(i)) soc = Math.max(soc, Math.min(hi, soc + solarIn[i]!))
        if (discharge.has(i)) {
          soc -= dischargeKwhPerSlot
          if (lo - soc > under + 1e-12) {
            under = lo - soc
            at = i
          }
        }
        over = Math.max(over, soc - hi)
      }
      return { under, at, over }
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
        let { under, at, over } = limits()
        // Buy the shortfall in the cheapest slot before the point where the level runs short, which can be after
        // this slot when it takes energy that a later discharge counted on (never dearer than that discharge)
        const tried = new Set<number>()
        while (cfg.gridCharge && short() > 1e-9 && at >= 0) {
          let c = -1
          for (let i = 0; i < at; i++) {
            if (discharge.has(i) || tried.has(i) || (chargeLeft.get(i) ?? chargeKwhPerSlot) <= 1e-9) continue
            if (slots[i]!.price >= slots[at]!.price) continue
            if (c === -1 || slots[i]!.price < slots[c]!.price) c = i
          }
          if (c === -1) break
          tried.add(c)
          const left = chargeLeft.get(c) ?? chargeKwhPerSlot
          const take = Math.min(left, short())
          chargeUsed.set(c, (chargeUsed.get(c) ?? 0) + take)
          const next = limits()
          if (next.over > base.over + 1e-9) {
            chargeUsed.set(c, chargeUsed.get(c)! - take)
            if (chargeUsed.get(c)! <= 1e-9) chargeUsed.delete(c)
            continue
          }
          chargeLeft.set(c, left - take)
          added.set(c, (added.get(c) ?? 0) + take)
          ;({ under, at, over } = next)
          if (take < left - 1e-9) tried.delete(c) // room left there for a later shortfall
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
