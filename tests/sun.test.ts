import { describe, expect, it } from 'vitest'
import { HOME_LOCATION, nextSunEvents, skyFor, sunPosition } from '../app/utils/sun'

const local = (d: Date) => d.toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' })
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

describe('sun over Waddinxveen', () => {
  it('stands about 38° high at solar noon on the March equinox', () => {
    // Solar noon in Waddinxveen is ~12:26 UTC around 20 March
    const { altitude } = sunPosition(new Date('2026-03-20T12:26:00Z'), HOME_LOCATION.lat, HOME_LOCATION.lon)
    expect(altitude).toBeGreaterThan(36.5)
    expect(altitude).toBeLessThan(39.5)
  })

  it('is far below the horizon at midnight and east of south in the morning', () => {
    expect(sunPosition(new Date('2026-10-17T22:00:00Z')).altitude).toBeLessThan(-25)
    expect(sunPosition(new Date('2026-10-17T07:00:00Z')).hourAngle).toBeLessThan(0)
    expect(sunPosition(new Date('2026-10-17T14:00:00Z')).hourAngle).toBeGreaterThan(0)
  })

  it('rises around 08:15 and sets around 18:35 on 17 October 2026', () => {
    const { sunrise, sunset } = nextSunEvents(new Date('2026-10-16T22:00:00Z'))
    expect(sunrise && sunset).toBeTruthy()
    expect(Math.abs(minutes(local(sunrise!)) - minutes('08:15'))).toBeLessThanOrEqual(10)
    expect(Math.abs(minutes(local(sunset!)) - minutes('18:35'))).toBeLessThanOrEqual(10)
  })

  it('darkens the sky as the sun goes down', () => {
    expect(skyFor(30).darkness).toBe(0)
    expect(skyFor(30).stars).toBe(0)
    expect(skyFor(-3).darkness).toBeGreaterThan(0.4)
    expect(skyFor(-20).darkness).toBe(1)
    expect(skyFor(-20).stars).toBe(1)
  })
})
