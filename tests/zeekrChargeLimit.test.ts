import { describe, expect, it } from 'vitest'
import { chargeLimitCommand, isChargeLimitPct } from '../server/providers/zeekr'
import { settledTarget } from '../server/services/zeekr'

describe('Zeekr charge limit', () => {
  it('accepts 50% to 100% in steps of 5', () => {
    expect(isChargeLimitPct(75)).toBe(true)
    expect(isChargeLimitPct(100)).toBe(true)
    expect(isChargeLimitPct(50)).toBe(true)
    expect(isChargeLimitPct(45)).toBe(false)
    expect(isChargeLimitPct(105)).toBe(false)
    expect(isChargeLimitPct(77)).toBe(false)
    expect(isChargeLimitPct('75')).toBe(false)
  })

  it('sends the limit as percent x 10 to the RCS charge service', () => {
    const cmd = chargeLimitCommand(75)
    expect(cmd.command).toBe('start')
    expect(cmd.serviceId).toBe('RCS')
    expect(cmd.setting.serviceParameters).toContainEqual({ key: 'soc', value: '750' })
    expect(cmd.setting.serviceParameters).toContainEqual({ key: 'rcs.setting', value: '1' })
  })

  it('keeps a limit just set while the car still reports the old one', () => {
    const now = new Date('2026-11-23T16:00:00Z')
    const set = { soc: 0.75, at: '2026-11-23T15:55:00Z' }
    expect(settledTarget(1, set, now)).toBe(0.75)
    expect(settledTarget(null, set, now)).toBe(0.75)
    expect(settledTarget(0.75, set, now)).toBe(0.75)
    // After a while the car's own value counts again, also when changed in the Zeekr app
    expect(settledTarget(0.9, { soc: 0.75, at: '2026-11-23T15:30:00Z' }, now)).toBe(0.9)
    expect(settledTarget(0.9, undefined, now)).toBe(0.9)
  })
})
