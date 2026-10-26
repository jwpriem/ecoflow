import { describe, expect, it } from 'vitest'
import { departureChanges, departureKey, departureSchedule, matchTibberVehicle, tibberBatteryLevel } from '../server/services/tibberEv'

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

describe('departure schedule in Tibber', () => {
  const offline = [
    { key: 'offline.vehicle.batteryLevel', value: '60' },
    { key: 'offline.vehicle.departureTimes.monday', value: '07:00' },
    { key: 'offline.vehicle.departureTimes.tuesday', value: '07:00' },
    { key: 'offline.vehicle.departureTimes.wednesday', value: null },
    { key: 'offline.vehicle.departureTimes.saturday', value: 'No departure time' },
  ]

  it('reads the weekly schedule, invalid values as no departure time', () => {
    expect(departureSchedule(offline)).toEqual({
      monday: '07:00', tuesday: '07:00', wednesday: null, thursday: null, friday: null, saturday: null, sunday: null,
    })
  })

  it("uses the car's own key namespace", () => {
    const online = [{ key: 'online.vehicle.smartCharging.departureTimes.friday', value: '9:30' }]
    expect(departureKey(online, 'friday')).toBe('online.vehicle.smartCharging.departureTimes.friday')
    expect(departureKey(online, 'monday')).toBe('offline.vehicle.departureTimes.monday')
    expect(departureSchedule(online).friday).toBe('09:30')
  })

  it('sets the chosen day and clears only the other days that have a time', () => {
    expect(departureChanges(offline, 'thursday', '08:00')).toEqual([
      { key: 'offline.vehicle.departureTimes.thursday', value: '08:00' },
      { key: 'offline.vehicle.departureTimes.monday', value: null },
      { key: 'offline.vehicle.departureTimes.tuesday', value: null },
    ])
  })

  it('leaves a day that already has the time alone', () => {
    expect(departureChanges(offline, 'monday', '07:00')).toEqual([{ key: 'offline.vehicle.departureTimes.tuesday', value: null }])
  })

  it('clears every other day when the current settings are unknown', () => {
    const changes = departureChanges(null, 'sunday', '12:00')
    expect(changes[0]).toEqual({ key: 'offline.vehicle.departureTimes.sunday', value: '12:00' })
    expect(changes.slice(1).map((c) => c.value)).toEqual([null, null, null, null, null, null])
  })
})
