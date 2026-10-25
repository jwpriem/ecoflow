import { describe, expect, it } from 'vitest'
import { matchTibberVehicle, tibberBatteryLevel } from '../server/services/tibberEv'

describe('battery level sent to Tibber', () => {
  it('is the state of charge when the car charges to 100%', () => {
    expect(tibberBatteryLevel(0.82, 1)).toBe(82)
    expect(tibberBatteryLevel(0.82, null)).toBe(82)
  })

  it('adds the part above the charge limit, as Tibber asks for', () => {
    // Tibber's own example: 80% limit, at 20% -> enter 40%
    expect(tibberBatteryLevel(0.2, 0.8)).toBe(40)
  })

  it('stays within 0-100', () => {
    expect(tibberBatteryLevel(0.9, 0.8)).toBe(100)
    expect(tibberBatteryLevel(0, 1)).toBe(0)
  })
})

describe('matching our cars to Tibber cars', () => {
  const tibber = [
    { id: 'a', name: 'Zeekr 001' },
    { id: 'b', name: 'Zeekr X' },
  ]

  it('matches on the model words other than the brand', () => {
    expect(matchTibberVehicle({ name: 'JPX73G', model: 'Zeekr 001' }, tibber)).toBe('a')
    expect(matchTibberVehicle({ name: 'JHX67T', model: 'Zeekr X' }, tibber)).toBe('b')
  })

  it('matches on the plate when the Tibber name carries it', () => {
    expect(matchTibberVehicle({ name: 'JPX73G', model: null }, [{ id: 'c', name: 'Auto JPX-73-G' }])).toBe('c')
  })

  it('leaves it unmapped when nothing or more than one car matches', () => {
    expect(matchTibberVehicle({ name: 'JPX73G', model: 'Zeekr 7X' }, tibber)).toBeUndefined()
    expect(matchTibberVehicle({ name: 'JPX73G', model: 'Zeekr 001' }, [...tibber, { id: 'd', name: 'Zeekr 001 FR' }])).toBeUndefined()
    expect(matchTibberVehicle({ name: 'JPX73G', model: null }, tibber)).toBeUndefined()
  })
  it('matches cars with the same title by battery size', () => {
    const same = [
      { id: 'a', name: 'Zeekr 100 kWh' },
      { id: 'b', name: 'Zeekr 66 kWh' },
    ]
    expect(matchTibberVehicle({ name: 'JPX73G', model: 'Zeekr 001', capacityKwh: 100 }, same)).toBe('a')
    expect(matchTibberVehicle({ name: 'JHX67T', model: 'Zeekr X', capacityKwh: 66 }, same)).toBe('b')
  })
})
