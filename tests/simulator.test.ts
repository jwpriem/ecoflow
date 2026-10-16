import { describe, expect, it } from 'vitest'
import { simulateStep } from '../server/lib/simulator'

const dev = { id: 1, capacityWh: 1920, maxChargeW: 1200, maxDischargeW: 800 }
const limits = { reserveSoc: 0.1, maxSoc: 1, legEfficiency: 0.95 }
const st = (soc: number, mode: any = 'self_use', commandW?: number) => ({ soc, mode, commandW, powerW: 0, pvW: 0, ts: '' })

describe('simulateStep', () => {
  it('self_use charges from surplus and covers load', () => {
    expect(simulateStep([{ device: dev, state: st(0.5) }], -500, 60, limits, new Date())[0]!.powerW).toBe(500)
    expect(simulateStep([{ device: dev, state: st(0.5) }], 300, 60, limits, new Date())[0]!.powerW).toBe(-300)
  })

  it('caps discharge at max power and stops at reserve', () => {
    expect(simulateStep([{ device: dev, state: st(0.5) }], 3000, 60, limits, new Date())[0]!.powerW).toBe(-800)
    expect(simulateStep([{ device: dev, state: st(0.1) }], 300, 60, limits, new Date())[0]!.powerW).toBe(0)
  })

  it('solar_only never discharges, charge_grid charges at the commanded power', () => {
    expect(simulateStep([{ device: dev, state: st(0.5, 'solar_only') }], 300, 60, limits, new Date())[0]!.powerW).toBe(0)
    expect(simulateStep([{ device: dev, state: st(0.5, 'charge_grid', 700) }], 300, 60, limits, new Date())[0]!.powerW).toBe(700)
  })

  it('splits load over two batteries by capacity', () => {
    const r = simulateStep([{ device: dev, state: st(0.5) }, { device: { ...dev, id: 2 }, state: st(0.5) }], 600, 60, limits, new Date())
    expect(r.map((x) => x.powerW)).toEqual([-300, -300])
  })
})
