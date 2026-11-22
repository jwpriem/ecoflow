import { afterEach, describe, expect, it, vi } from 'vitest'
import { degrees, weatherIcon, weatherKind } from '../app/utils/weather'
import type { sites } from '../server/db/schema'
import { openMeteoCurrent } from '../server/providers/openMeteo'
import { currentWeather, resetWeatherCache } from '../server/services/weather'

type Site = typeof sites.$inferSelect
const site = (location: Site['location']) => ({ location }) as Site
const answer = (temp: number, code: number) =>
  new Response(JSON.stringify({ current: { time: '2026-11-22T20:15', temperature_2m: temp, weather_code: code } }))

describe('weatherKind', () => {
  it('groups the WMO codes into the kinds Home shows', () => {
    expect([0, 1, 2, 3, 45, 53, 61, 81, 73, 86, 95, 99].map(weatherKind)).toEqual(
      ['clear', 'clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'rain', 'snow', 'snow', 'thunder', 'thunder'],
    )
  })

  it('shows the moon after dark, and never -0°', () => {
    expect(weatherIcon('clear', true)).toBe('moon')
    expect(weatherIcon('partly', false)).toBe('cloud-sun')
    expect(degrees(-0.3)).toBe('0°')
    expect(degrees(7.6)).toBe('8°')
  })
})

describe('openMeteoCurrent', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the temperature and weather code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(7.4, 3)))
    expect(await openMeteoCurrent(52, 4.7)).toEqual({ tempC: 7.4, code: 3, at: new Date('2026-11-22T20:15:00Z') })
  })

  it('returns null without values', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ current: { time: '2026-11-22T20:15' } }))))
    expect(await openMeteoCurrent(52, 4.7)).toBeNull()
  })
})

describe('currentWeather', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetWeatherCache()
  })

  it('asks once per location and shares the answer', async () => {
    const fetch = vi.fn(async () => answer(5, 61))
    vi.stubGlobal('fetch', fetch)
    const gouda = site({ lat: 52, lon: 4.7, place: 'Gouda', source: 'tibber' })
    expect((await currentWeather(gouda))?.code).toBe(61)
    await currentWeather(gouda)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]![0])).toContain('latitude=52&longitude=4.7')
  })

  it("doesn't hold Home up when Open-Meteo is slow", async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const pending = currentWeather(site(null))
    await vi.advanceTimersByTimeAsync(1600)
    expect(await pending).toBeNull()
  })
})
