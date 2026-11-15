import { describe, expect, it } from 'vitest'
import { ALERT_THRESHOLDS, SecurityCounter } from '../server/lib/securityEvents'

describe('security event counter', () => {
  it('counts per hour and alerts above the threshold', () => {
    const c = new SecurityCounter()
    for (let i = 0; i <= ALERT_THRESHOLDS.loginFailed; i++) c.record('loginFailed')
    c.record('rateLimited')
    const r = c.flush()
    expect(r.counts).toEqual({ loginFailed: ALERT_THRESHOLDS.loginFailed + 1, rateLimited: 1 })
    expect(r.alerts).toEqual(['loginFailed'])
    expect(c.flush()).toEqual({ counts: { loginFailed: 0, rateLimited: 0 }, alerts: [] })
  })
})
