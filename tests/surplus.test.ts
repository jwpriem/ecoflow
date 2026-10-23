import { describe, expect, it } from 'vitest'
import { idleSurplus, type SurplusState, surplusStep } from '../server/lib/surplus'

const base = { batteryW: 0, chargeCapW: 2100, socPct: 50, maxPct: 95, eligible: true }
const run = (minutes: { gridW: number | undefined; batteryW?: number }[], st: SurplusState = idleSurplus(), extra = {}) => {
  const trace: boolean[] = []
  for (const m of minutes) {
    st = surplusStep(st, { ...base, ...extra, ...m, batteryW: m.batteryW ?? base.batteryW })
    trace.push(st.charging)
  }
  return { st, trace }
}

describe('surplusStep', () => {
  it('starts after three minutes of clear export', () => {
    const { trace } = run([{ gridW: -1500 }, { gridW: -1500 }, { gridW: -1500 }])
    expect(trace).toEqual([false, false, true])
  })

  it('does not start on a short burst or a small surplus', () => {
    expect(run([{ gridW: -1500 }, { gridW: -200 }, { gridW: -1500 }, { gridW: -1500 }]).trace.at(-1)).toBe(false)
    expect(run(Array(10).fill({ gridW: -600 })).trace.at(-1)).toBe(false)
  })

  it('keeps charging while most of the charge is solar', () => {
    const charging = { charging: true, streak: 0 }
    // charging 2.1 kW, importing 400 W: 80% solar
    expect(run(Array(10).fill({ gridW: 400, batteryW: 2100 }), charging).st.charging).toBe(true)
  })

  it('stops after three minutes where the grid supplies more than half', () => {
    const charging = { charging: true, streak: 0 }
    const { trace } = run([{ gridW: 1500, batteryW: 2100 }, { gridW: 1500, batteryW: 2100 }, { gridW: 1500, batteryW: 2100 }], charging)
    expect(trace).toEqual([true, true, false])
  })

  it('stops when the batteries do not respond and the house imports', () => {
    const charging = { charging: true, streak: 0 }
    expect(run(Array(3).fill({ gridW: 400, batteryW: 0 }), charging).st.charging).toBe(false)
  })

  it('stops at once when full or no longer eligible', () => {
    const charging = { charging: true, streak: 0 }
    expect(run([{ gridW: -500, batteryW: 2100 }], charging, { socPct: 94.5 }).st.charging).toBe(false)
    expect(run([{ gridW: -500, batteryW: 2100 }], charging, { eligible: false }).st.charging).toBe(false)
  })

  it('keeps its state while the Pulse is quiet', () => {
    const charging = { charging: true, streak: 1 }
    expect(run([{ gridW: undefined }], charging).st).toEqual(charging)
  })
})
