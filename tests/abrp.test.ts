import { afterEach, describe, expect, it, vi } from 'vitest'
import { abrpSend } from '../server/providers/abrp'
import { resetProviders } from '../server/providers/http'
import { zeekrExtras } from '../server/providers/zeekr'
import { isOnTheMove, statusTime, toTelemetry } from '../server/services/abrp'
import type { VehicleState } from '../server/services/zeekr'

const NOW = new Date('2026-11-14T17:00:00Z')

const car = (over: Partial<VehicleState> = {}): VehicleState => ({
  soc: 0.634,
  rangeKm: 280,
  charging: false,
  pluggedIn: false,
  chargePowerW: null,
  targetSoc: 0.8,
  lat: 52.1,
  lon: 5.1,
  online: true,
  statusAt: '1763139540000',
  atHome: false,
  ts: NOW.toISOString(),
  ...over,
})

describe('Zeekr status time', () => {
  it('reads epoch milliseconds, seconds and ISO', () => {
    expect(statusTime('1763139540000', NOW).toISOString()).toBe('2025-11-14T16:59:00.000Z')
    expect(statusTime('1763139540', NOW).toISOString()).toBe('2025-11-14T16:59:00.000Z')
    expect(statusTime('2026-11-14T16:58:00Z', NOW).toISOString()).toBe('2026-11-14T16:58:00.000Z')
  })

  it('falls back to now when missing or unreadable', () => {
    expect(statusTime(null, NOW)).toBe(NOW)
    expect(statusTime('soon', NOW)).toBe(NOW)
  })
})

describe('ABRP telemetry from a Zeekr reading', () => {
  it('sends the level in percent, the position and the time in seconds', () => {
    const t = toTelemetry(car({ driving: true, speedKmh: 87, headingDeg: 140, odometerKm: 12345 }), 95, NOW)
    expect(t).toMatchObject({ utc: 1763139540, soc: 63.4, lat: 52.1, lon: 5.1, speed: 87, heading: 140, odometer: 12345, is_charging: 0, is_parked: 0 })
    expect(t.capacity).toBe(95)
    expect(t.soe).toBeCloseTo(60.23, 2)
    expect(t.est_battery_range).toBe(280)
    expect(t.power).toBeUndefined()
  })

  it('sends charging power as negative kW and flags a DC fast charger', () => {
    const ac = toTelemetry(car({ charging: true, pluggedIn: true, chargePowerW: 11000 }), null, NOW)
    expect(ac).toMatchObject({ is_charging: 1, power: -11, is_dcfc: 0, is_parked: 1, speed: 0 })
    const dc = toTelemetry(car({ charging: true, pluggedIn: true, chargePowerW: 180000 }), null, NOW)
    expect(dc).toMatchObject({ is_charging: 1, power: -180, is_dcfc: 1 })
  })

  it('leaves out what the car does not report', () => {
    const t = toTelemetry(car({ soc: null, lat: null, lon: null, statusAt: null }), null, NOW)
    expect(t).toEqual({ utc: Math.floor(NOW.getTime() / 1000), is_charging: 0, est_battery_range: 280 })
  })

  it('marks a switched-off car as parked', () => {
    expect(toTelemetry(car({ driving: false }), null, NOW)).toMatchObject({ is_parked: 1, speed: 0 })
  })
})

describe('reading every minute while on the move', () => {
  it('is on while driving or moving, or shortly after', () => {
    expect(isOnTheMove(car({ driving: true }), NOW)).toBe(true)
    expect(isOnTheMove(car({ speedKmh: 30 }), NOW)).toBe(true)
    expect(isOnTheMove(car({ movedAt: new Date(NOW.getTime() - 4 * 60_000).toISOString() }), NOW)).toBe(true)
  })

  it('is off when parked for a while, plugged in or never seen moving', () => {
    expect(isOnTheMove(car({ movedAt: new Date(NOW.getTime() - 11 * 60_000).toISOString() }), NOW)).toBe(false)
    expect(isOnTheMove(car({ driving: true, pluggedIn: true }), NOW)).toBe(false)
    expect(isOnTheMove(car(), NOW)).toBe(false)
    expect(isOnTheMove({}, NOW)).toBe(false)
  })
})

describe('extra Zeekr fields', () => {
  it('reads speed, drive state, odometer, heading and tyres', () => {
    const x = zeekrExtras({
      basicVehicleStatus: { engineStatus: 'engine-running', speed: '72.5', position: { direction: '181', altitude: '3' } },
      additionalVehicleStatus: {
        maintenanceStatus: { odometer: '23456.0', tyreStatusDriver: '250', tyreStatusPassenger: '252', tyreStatusDriverRear: '248', tyreStatusPassengerRear: '249' },
        climateStatus: { interiorTemp: '21.5' },
      },
    })
    expect(x).toEqual({
      speedKmh: 72.5,
      driving: true,
      odometerKm: 23456,
      headingDeg: 181,
      altitudeM: 3,
      extTempC: null,
      cabinTempC: 21.5,
      tyresKpa: { fl: 250, fr: 252, rl: 248, rr: 249 },
    })
  })

  it('gives nulls for a bare status', () => {
    expect(zeekrExtras({})).toMatchObject({ speedKmh: null, driving: null, tyresKpa: null })
    expect(zeekrExtras({ basicVehicleStatus: { engineStatus: 'engine-off' } }).driving).toBe(false)
  })
})

describe('sending to ABRP', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetProviders()
  })

  it('posts the token and telemetry with the API key in the header', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await abrpSend('KEY', 'TOKEN', { utc: 1, soc: 50 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.iternio.com/1/tlm/send')
    expect((init.headers as Record<string, string>).Authorization).toBe('APIKEY KEY')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('token')).toBe('TOKEN')
    expect(JSON.parse(body.get('tlm')!)).toEqual({ utc: 1, soc: 50 })
  })

  it('throws what ABRP says when it refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'error', error: 'Invalid token' }), { status: 200 })))
    await expect(abrpSend('KEY', 'BAD', { utc: 1 })).rejects.toThrow('Invalid token')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))
    await expect(abrpSend('BAD', 'T', { utc: 1 })).rejects.toThrow('HTTP 401')
  })
})
