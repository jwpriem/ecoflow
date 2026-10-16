import { describe, expect, it } from 'vitest'
import { projectSoc } from '../server/lib/socForecast'

const t0 = new Date('2027-02-01T00:00:00Z')
const slot = (i: number, action: any, targetW?: number) => ({ slotStart: new Date(t0.getTime() + i * 900_000), action, targetW })
const opts = { capacityWh: 3840, maxChargeW: 1600, maxDischargeW: 1600, avgLoadW: 800, reserveSoc: 0.1, maxSoc: 0.95, legEfficiency: 1 }

describe('projectSoc', () => {
  it('starts at the current level and adds one point per slot', () => {
    const p = projectSoc(0.5, [slot(0, 'self_use'), slot(1, 'solar_only')], opts)
    expect(p.map((x) => x.soc)).toEqual([0.5, 0.5, 0.5])
    expect(p[2]!.ts.getTime()).toBe(t0.getTime() + 2 * 900_000)
  })

  it('charges and discharges within the limits', () => {
    const up = projectSoc(0.9, [slot(0, 'charge_grid'), slot(1, 'charge_grid')], opts)
    expect(up.at(-1)!.soc).toBe(0.95)
    const down = projectSoc(0.15, [slot(0, 'discharge'), slot(1, 'discharge')], opts)
    expect(down[1]!.soc).toBeCloseTo(0.15 - 200 / 3840)
    expect(down.at(-1)!.soc).toBe(0.1)
  })

  it('never moves a level that is already past a limit the wrong way', () => {
    expect(projectSoc(0.05, [slot(0, 'discharge')], opts).at(-1)!.soc).toBe(0.05)
    expect(projectSoc(1, [slot(0, 'charge_grid')], opts).at(-1)!.soc).toBe(1)
  })
})
