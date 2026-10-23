import { describe, expect, it } from 'vitest'
import { hasReasonTranslation, translateReason } from '../app/i18n/reasons'
import { buildPlan } from '../server/lib/strategy'
import { defaultStrategy } from '../server/lib/types'

// A small seeded generator, so a failure can be reproduced
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32)
}

describe('plan reasons in Dutch', () => {
  it('has a translation for every reason the planner writes', () => {
    const rand = rng(7)
    const seen = new Set<string>()
    for (let run = 0; run < 300; run++) {
      const n = 24 + Math.floor(rand() * 72)
      const base = Date.UTC(2027, 1, 1)
      const feedFactor = rand() < 0.5 ? 1 : 0.2
      const prices = Array.from({ length: n }, (_, i) => {
        const total = Math.round((0.05 + rand() * 0.4) * 1000) / 1000
        return { slotStart: new Date(base + i * 900_000), total, energy: total / 2, feedIn: total * feedFactor }
      })
      const plan = buildPlan({
        prices,
        storedKwh: rand() * 3.84,
        capacityKwh: 3.84,
        maxChargeW: 2000,
        maxDischargeW: 1600,
        poolAvgCost: rand() * 0.3,
        solarW: rand() < 0.5 ? prices.map(() => (rand() < 0.3 ? rand() * 4000 : 0)) : undefined,
        timeZone: 'UTC',
        cfg: { ...defaultStrategy, avgLoadW: 450, maxOutputW: 800, gridCharge: rand() < 0.8, dailyCycleKwh: rand() < 0.5 ? 3 : 0 },
      })
      for (const p of plan) seen.add(p.reason)
    }
    const missing = [...seen].filter((r) => !hasReasonTranslation(r))
    expect(missing).toEqual([])
    // Every kind of reason came up at least once
    expect(seen.size).toBeGreaterThan(9)
  })

  it('uses a decimal comma and keeps unknown reasons as they are', () => {
    expect(translateReason('cheap slot (€0.123) to cover later peaks', 'nl')).toBe('goedkoop kwartier (€0,123) voor latere pieken')
    expect(translateReason('cheap slot (€0.123) to cover later peaks', 'en')).toBe('cheap slot (€0.123) to cover later peaks')
    expect(translateReason('something new', 'nl')).toBe('something new')
  })
})
