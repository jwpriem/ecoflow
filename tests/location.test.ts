import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../server/db/client'
import * as schema from '../server/db/schema'
import { coarseLocation, forecastLocation } from '../server/lib/location'
import type { TibberHome } from '../server/providers/tibber'
import { createAccount } from '../server/services/setup'
import { freshDb } from './support/pglite'

// Open-Meteo answers with one slot whose value says which location was asked for
const calls: string[] = []
vi.mock('../server/providers/openMeteo', () => ({
  openMeteoIrradiance: vi.fn(async (lat: number, lon: number) => {
    calls.push(`${lat},${lon}`)
    return [{ slotStart: new Date('2027-06-01T12:00:00Z'), ghi: lat * 10 }]
  }),
}))
const { locationFromTibber, setLocation } = await import('../server/services/location')
const { refreshIrradiance, resetIrradianceFetches } = await import('../server/services/solarForecast')

const home = (latitude: string | null, longitude: string | null, city = 'Gouda'): TibberHome => ({
  id: 'h1',
  appNickname: null,
  address: { address1: 'Markt 1', city, latitude, longitude },
  features: { realTimeConsumptionEnabled: true },
})

describe('coarseLocation', () => {
  it('rounds to 0.1° and refuses what isn\'t a coordinate', () => {
    expect(coarseLocation('52.0118', '4.7104', 'tibber', 'Gouda')).toEqual({ lat: 52, lon: 4.7, place: 'Gouda', source: 'tibber' })
    expect(coarseLocation(51.4416, 5.4697, 'manual')).toEqual({ lat: 51.4, lon: 5.5, source: 'manual' })
    for (const [la, lo] of [[null, '4'], ['', '4'], ['abc', '4'], [91, 4], [52, 181]]) expect(coarseLocation(la, lo, 'manual')).toBeNull()
  })

  it('keeps the original fixed location for a household without one', () => {
    expect(forecastLocation(null)).toEqual({ lat: 52.035, lon: 4.651 })
    expect(forecastLocation({ lat: 53.2, lon: 6.6, source: 'manual' })).toEqual({ lat: 53.2, lon: 6.6 })
  })
})

describe('household location', () => {
  let db: Db
  beforeAll(async () => {
    db = await freshDb()
  })
  beforeEach(() => {
    calls.length = 0
    resetIrradianceFetches()
  })

  it('comes from the Tibber home, but never over one the owner set', async () => {
    let { site } = await createAccount(db, 'loc@example.com', 'long-enough')
    expect(site.location).toBeNull()
    const first = await locationFromTibber(db, site, home('52.0118', '4.7104'))
    expect(first).toMatchObject({ changed: true, site: { location: { lat: 52, lon: 4.7, place: 'Gouda', source: 'tibber' } } })
    // Same square: nothing to do
    expect((await locationFromTibber(db, first.site, home('52.03', '4.69'))).changed).toBe(false)
    // No coordinates at Tibber: keep what there is
    expect((await locationFromTibber(db, first.site, home(null, null))).changed).toBe(false)
    site = await setLocation(db, first.site, coarseLocation(53.2194, 6.5665, 'manual', 'Groningen'))
    const after = await locationFromTibber(db, site, home('52.0118', '4.7104'))
    expect(after.changed).toBe(false)
    expect(after.site.location).toMatchObject({ lat: 53.2, lon: 6.6, source: 'manual' })
  })

  it('gives households elsewhere their own forecast, with one call per area', async () => {
    const mk = async (email: string, loc: ReturnType<typeof coarseLocation>) => setLocation(db, (await createAccount(db, email, 'long-enough')).site, loc)
    const gouda1 = await mk('g1@example.com', coarseLocation(52.01, 4.71, 'tibber'))
    const gouda2 = await mk('g2@example.com', coarseLocation(52.04, 4.68, 'tibber'))
    const groningen = await mk('gr@example.com', coarseLocation(53.22, 6.57, 'tibber'))
    const unset = (await createAccount(db, 'u@example.com', 'long-enough')).site
    for (const s of [gouda1, gouda2, groningen, unset]) await refreshIrradiance(db, s)
    expect(calls.sort()).toEqual(['52,4.7', '52.035,4.651', '53.2,6.6'])
    const ghi = async (siteId: number) => (await db.select().from(schema.irradiance).where(eq(schema.irradiance.siteId, siteId)))[0]!.ghi
    expect(await ghi(gouda1.id)).toBe(520)
    expect(await ghi(gouda2.id)).toBe(520)
    expect(await ghi(groningen.id)).toBe(532)
    expect(await ghi(unset.id)).toBeCloseTo(520.35)
  })
})
