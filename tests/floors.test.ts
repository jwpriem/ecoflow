import { describe, expect, it } from 'vitest'
import { checkFloorName, checkPlacements, checkPlan, MAX_PLAN_CHARS } from '../server/lib/floors'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('floor plans', () => {
  it('takes images as data URLs and refuses anything else', () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`
    expect(checkPlan(svg)).toBe(svg)
    expect(checkPlan(null)).toBeNull()
    expect(() => checkPlan('data:text/html;base64,PGgxPg==')).toThrow()
    expect(() => checkPlan('https://example.com/plan.png')).toThrow()
    expect(() => checkPlan(`data:image/png;base64,${'A'.repeat(MAX_PLAN_CHARS)}`)).toThrow(/too large/)
  })

  it('needs a name', () => {
    expect(checkFloorName('  Begane grond ')).toBe('Begane grond')
    expect(() => checkFloorName(' ')).toThrow()
  })

  it('keeps valid placements once, inside the plan', () => {
    const out = checkPlacements([
      { kind: 'light', id: id(1), x: 0.25, y: 0.5 },
      { kind: 'light', id: id(1), x: 0.3, y: 0.3 },
      { kind: 'group', id: id(2), x: 1.4, y: -0.2 },
      { kind: 'lamp', id: id(3), x: 0.1, y: 0.1 },
      { kind: 'light', id: 'nope', x: 0.1, y: 0.1 },
      { kind: 'light', id: id(4), x: 'a', y: 0.1 },
    ])
    expect(out).toEqual([
      { kind: 'light', id: id(1), x: 0.25, y: 0.5 },
      { kind: 'group', id: id(2), x: 1, y: 0 },
    ])
    expect(() => checkPlacements('x')).toThrow()
  })
})
