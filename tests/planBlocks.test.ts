import { describe, expect, it } from 'vitest'
import { blockAt, buildBlocks, daySummaries, localDayKey, type PlanSlot } from '../app/utils/planBlocks'

const Q = 15 * 60_000
function slots(from: Date, spec: [string | null, number, string?][], solarW = 0): PlanSlot[] {
  const out: PlanSlot[] = []
  let t = from.getTime()
  for (const [action, n, reason] of spec) {
    for (let i = 0; i < n; i++, t += Q) out.push({ slotStart: new Date(t).toISOString(), total: 0.2 + i / 100, action, reason: reason ?? null, solarW })
  }
  return out
}

describe('plan blocks', () => {
  it('joins quarters with the same action and reason', () => {
    const b = buildBlocks(slots(new Date(2026, 10, 6, 14), [['self_use', 4], ['solar_only', 2], ['discharge', 3]]))
    expect(b.map((x) => [x.action, x.last - x.first])).toEqual([['self_use', 4], ['solar_only', 2], ['discharge', 3]])
    expect(b[0]!.end).toEqual(new Date(2026, 10, 6, 15))
    expect(b[0]!.min).toBeCloseTo(0.2)
    expect(b[0]!.max).toBeCloseTo(0.23)
  })

  it('keeps a block going past midnight, with no gaps between blocks', () => {
    const b = buildBlocks(slots(new Date(2026, 10, 6, 23), [['charge_grid', 24]]))
    expect(b).toHaveLength(1)
    expect(b[0]!.end).toEqual(new Date(2026, 10, 7, 5))
  })

  it('splits on a different reason and keeps quarters without a plan as their own block', () => {
    const b = buildBlocks(slots(new Date(2026, 10, 6, 10), [['self_use', 2, 'a'], ['self_use', 2, 'b'], [null, 2]]))
    expect(b.map((x) => [x.action, x.reason])).toEqual([['self_use', 'a'], ['self_use', 'b'], [null, '']])
    expect(b.every((x, i) => i === 0 || x.start.getTime() === b[i - 1]!.end.getTime())).toBe(true)
  })

  it('finds the block that holds a quarter', () => {
    const b = buildBlocks(slots(new Date(2026, 10, 6, 10), [['self_use', 3], ['discharge', 3]]))
    expect(blockAt(b, 4)).toBe(1)
    expect(blockAt(b, 99)).toBe(-1)
  })

  it('sums expected solar and the price range per day', () => {
    const s = slots(new Date(2026, 10, 6, 23), [['charge_grid', 8]], 2000)
    const days = daySummaries(s)
    expect(days.get(localDayKey(new Date(2026, 10, 6)))!.solarKwh).toBeCloseTo(2)
    expect(days.get(localDayKey(new Date(2026, 10, 7)))!.max).toBeCloseTo(0.27)
  })
})
