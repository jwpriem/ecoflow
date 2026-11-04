import { describe, expect, it } from 'vitest'
import { carSocFromTibber, chargeWindows, departureChanges, departureKey, departureSchedule, matchTibberVehicle, tibberBatteryLevel, tibberPushStep } from '../server/services/tibberEv'

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

describe("Tibber's charging plan", () => {
  const p = (startAt: string, stopAt: string, from: number, to: number, energy: number, cost: number) => ({
    startAt, stopAt, fromStateOfCharge: from, toStateOfCharge: to, energy, cost,
  })
  const now = new Date('2026-11-04T20:00:00Z')

  it('merges back-to-back periods into one window and adds up energy and cost', () => {
    const w = chargeWindows(
      [
        p('2026-11-05T01:15:00Z', '2026-11-05T01:30:00Z', 45, 48, 2.75, 0.5),
        p('2026-11-05T01:00:00Z', '2026-11-05T01:15:00Z', 42, 45, 2.75, 0.55),
        p('2026-11-05T03:00:00Z', '2026-11-05T03:15:00Z', 48, 50, 2, 0.4),
      ],
      now,
    )
    expect(w).toEqual([
      { start: '2026-11-05T01:00:00.000Z', end: '2026-11-05T01:30:00.000Z', fromSoc: 42, toSoc: 48, energyKwh: 5.5, cost: 1.05 },
      { start: '2026-11-05T03:00:00.000Z', end: '2026-11-05T03:15:00.000Z', fromSoc: 48, toSoc: 50, energyKwh: 2, cost: 0.4 },
    ])
  })

  it('keeps a pause without energy as a gap between windows', () => {
    const w = chargeWindows(
      [
        p('2026-11-04T22:00:00Z', '2026-11-04T22:30:00Z', 24, 27, 2.8, 1),
        p('2026-11-04T22:30:00Z', '2026-11-04T23:00:00Z', 27, 27, 0, 0),
        p('2026-11-04T23:00:00Z', '2026-11-05T05:15:00Z', 27, 100, 55.7, 21),
      ],
      now,
    )
    expect(w.map((x) => [x.start.slice(11, 16), x.end.slice(11, 16)])).toEqual([['22:00', '22:30'], ['23:00', '05:15']])
  })

  it('drops windows that already ended', () => {
    expect(chargeWindows([p('2026-11-04T18:00:00Z', '2026-11-04T19:00:00Z', 10, 20, 5, 1)], now)).toEqual([])
  })

  it("shows battery levels in the car's own terms when it has a charge limit", () => {
    // Limit 80%: Tibber was told 40% for a car at 20%, so its 100% is the car's 80%
    expect(carSocFromTibber(100, 0.8)).toBe(80)
    expect(carSocFromTibber(40, 0.8)).toBe(20)
    expect(carSocFromTibber(57, 1)).toBe(57)
    expect(carSocFromTibber(null, 0.8)).toBeNull()
    const [w] = chargeWindows([p('2026-11-05T01:00:00Z', '2026-11-05T02:00:00Z', 40, 100, 40, 8)], now, 0.8)
    expect([w!.fromSoc, w!.toSoc]).toEqual([20, 80])
  })
})

describe('sending the battery level to Tibber after plug-in', () => {
  const at = '2026-11-04T16:42:26Z'
  const plugged = { atHome: true, pluggedIn: true }

  it('sends it on plug-in, and again when the first push failed', () => {
    expect(tibberPushStep({}, new Date(at))).toBe('first')
    expect(tibberPushStep({ atHome: true, pluggedIn: false, tibberSyncedAt: at }, new Date(at))).toBe('first')
    expect(tibberPushStep(plugged, new Date(at))).toBe('first')
  })

  it('sends it once more a few minutes later, after Tibber started its session', () => {
    expect(tibberPushStep({ ...plugged, tibberSyncedAt: at }, new Date('2026-11-04T16:44:00Z'))).toBe('wait')
    expect(tibberPushStep({ ...plugged, tibberSyncedAt: at }, new Date('2026-11-04T16:47:20Z'))).toBe('again')
    expect(tibberPushStep({ ...plugged, tibberSyncedAt: at, tibberResyncedAt: '2026-11-04T16:47:20Z' }, new Date('2026-11-04T17:30:00Z'))).toBe('done')
  })
})
