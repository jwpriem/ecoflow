import { describe, expect, it } from 'vitest'
import { bucketKey, comparisonOf, isoWeek, projectTotal, rangeOf, shiftRange, slotsOf } from '../app/utils/savingsPeriod'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)

describe('savings periods', () => {
  it('runs a week from Monday to Monday', () => {
    const r = rangeOf('week', at(2026, 11, 6, 14)) // a Friday
    expect(r.start).toEqual(at(2026, 11, 2))
    expect(r.end).toEqual(at(2026, 11, 9))
    expect(rangeOf('week', at(2026, 11, 8, 23)).start).toEqual(at(2026, 11, 2)) // Sunday belongs to the week before
  })

  it('has one slot per day in a month and one per month in a year', () => {
    expect(slotsOf(rangeOf('month', at(2026, 11, 6)))).toHaveLength(30)
    expect(slotsOf(rangeOf('month', at(2028, 2, 10)))).toHaveLength(29)
    const year = slotsOf(rangeOf('year', at(2026, 11, 6)))
    expect(year).toHaveLength(12)
    expect(bucketKey(year[9]!)).toBe('2026-10-01T00:00')
  })

  it('steps across a year boundary', () => {
    const jan = rangeOf('month', at(2027, 1, 15))
    expect(shiftRange(jan, -1).start).toEqual(at(2026, 12, 1))
    expect(shiftRange(rangeOf('week', at(2027, 1, 1)), -1).start).toEqual(at(2026, 12, 21))
  })

  it('compares a running month with the same days of the month before', () => {
    const now = at(2026, 11, 6, 14)
    const c = comparisonOf(rangeOf('month', now), now)
    expect(c.partial).toBe(true)
    expect(c.from).toEqual(at(2026, 10, 1))
    expect(c.to).toEqual(at(2026, 10, 6, 14))
  })

  it('compares a finished month with the whole month before', () => {
    const c = comparisonOf(rangeOf('month', at(2026, 10, 12)), at(2026, 11, 6))
    expect(c).toEqual({ from: at(2026, 9, 1), to: at(2026, 10, 1), partial: false })
  })

  it('never compares past the end of a shorter month', () => {
    const now = at(2026, 3, 31, 12)
    expect(comparisonOf(rangeOf('month', now), now).to).toEqual(at(2026, 3, 1))
  })

  it('projects only a running period, once enough of it has passed', () => {
    const r = rangeOf('month', at(2026, 11, 1))
    expect(projectTotal(10, r, at(2026, 11, 2))).toBeNull()
    expect(projectTotal(10, r, at(2026, 11, 16))).toBeCloseTo(20)
    expect(projectTotal(10, r, at(2026, 12, 2))).toBeNull()
  })

  it('numbers weeks the ISO way', () => {
    expect(isoWeek(at(2026, 11, 6))).toBe(45)
    expect(isoWeek(at(2027, 1, 1))).toBe(53)
  })
})
