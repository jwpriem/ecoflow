import { and, asc, desc, eq, gte } from 'drizzle-orm'
import { batteryPool, devices, integrations, plans, samples } from '../db/schema'
import type { DeviceState } from '../providers/ecoflow'
import { slotStartOf, startOfLocalDay } from '../lib/time'
import { lastRing } from '../lib/nest'
import { morningSettings } from '../lib/sonos'
import { liveState } from '../services/collector'
import { isExperimentalProvider } from '../services/experimental'
import { getPrices } from '../services/prices'
import { savingsByPeriod } from '../services/ledger'
import { solarByPeriod } from '../services/solar'
import { pulseStatus } from '../providers/tibberPulse'
import { demoPulseStatus } from '../services/demoData'
import { currentWeather } from '../services/weather'
import { currentIndoor } from '../services/tuya'
import { forecastLocation } from '../lib/location'
import { SOLAR_LOCATION } from '../lib/solarForecast'

export default defineEventHandler(async (event) => {
  const { site, experimental, role } = await requireSite(event)
  const db = useDb()
  const now = new Date()
  const slot = slotStartOf(now)
  const dayStart = startOfLocalDay(now, site.timezone)
  const latest = (kind: 'grid' | 'solar') =>
    db.select().from(samples).where(and(eq(samples.siteId, site.id), eq(samples.kind, kind))).orderBy(desc(samples.ts)).limit(1).then((r) => r[0])
  const cached = liveState(site.id)

  // None of these depend on each other: run them together, so Home waits for one round trip instead of ten
  const [devs, pools, [price], next, [today], [solarToday], ints, grid, solar, weather, indoor] = await Promise.all([
    db.select().from(devices).where(eq(devices.siteId, site.id)).orderBy(asc(devices.id)),
    db
      .select({ pool: batteryPool })
      .from(batteryPool)
      .innerJoin(devices, eq(devices.id, batteryPool.deviceId))
      .where(eq(devices.siteId, site.id))
      .then((r) => r.map((p) => p.pool)),
    getPrices(db, site.id, slot, new Date(slot.getTime() + 15 * 60_000)),
    db.select().from(plans).where(and(eq(plans.siteId, site.id), gte(plans.slotStart, slot))).orderBy(asc(plans.slotStart)).limit(16),
    savingsByPeriod(db, site, 'day', dayStart, now),
    solarByPeriod(db, site, 'day', dayStart, now),
    db.select({ provider: integrations.provider, status: integrations.status, meta: integrations.meta }).from(integrations).where(eq(integrations.siteId, site.id)),
    // The last stored readings, only when the collector has no live state in memory (just after a restart)
    cached ? undefined : latest('grid'),
    cached ? undefined : latest('solar'),
    // Never holds Home up for long, and never fails it: null when Open-Meteo is slow or down
    currentWeather(site),
    // The indoor sensor (experimental): null without one, and like the weather it never holds Home up
    experimental ? currentIndoor(db, site, encryptionKey()) : null,
  ])

  let live = cached
  if (!live && grid) {
    live = { ts: grid.ts.toISOString(), gridW: grid.powerW, houseNetW: grid.powerW - devs.reduce((t, d) => t + ((d.state as DeviceState).powerW ?? 0), 0), solarW: solar?.powerW ?? null, houseSource: 'pulse', solarSource: solar ? 'solaredge' : null }
  }

  return {
    now: now.toISOString(),
    site: { name: site.name, controlMode: site.controlMode, override: site.override, timezone: site.timezone },
    // Where the household roughly is (0.1°), for the sun and the place name in the house scene
    location: { ...forecastLocation(site.location), place: site.location?.place ?? (site.location ? null : SOLAR_LOCATION.name) },
    // Outdoor temperature (°C) and WMO weather code at that location
    weather: weather ? { tempC: weather.tempC, code: weather.code, at: weather.at.toISOString() } : null,
    // Indoor temperature (°C) and humidity (%) from the Tuya sensor
    indoor: indoor && indoor.tempC !== null ? { tempC: indoor.tempC, humidity: indoor.humidity, name: indoor.name, at: indoor.at } : null,
    devices: devs.map((d) => {
      const s = d.state as DeviceState
      const pool = pools.find((p) => p.deviceId === d.id)
      return {
        id: d.id,
        name: d.name,
        model: d.model,
        driver: d.driver,
        capacityWh: d.capacityWh,
        soc: s.soc ?? null,
        powerW: s.powerW ?? 0,
        pvW: s.pvW ?? 0,
        mode: s.mode ?? null,
        updatedAt: s.ts ?? null,
        avgCostOpportunity: pool && pool.kwh > 0 ? pool.costOpportunity / pool.kwh : null,
        avgCostNaive: pool && pool.kwh > 0 ? pool.costNaive / pool.kwh : null,
        // What the energy now in this battery cost to put there (weighted average, losses included)
        stored: pool ? { kwh: pool.kwh, costNaive: pool.costNaive, costOpportunity: pool.costOpportunity } : null,
      }
    }),
    live: live ?? null,
    price: price ?? null,
    next: next.map((p) => ({ slotStart: p.slotStart, action: p.action, price: p.price, reason: p.reason, targetW: p.targetW })),
    today: today ?? null,
    solarToday: solarToday ?? null,
    sources: {
      pulse: site.isDemo ? demoPulseStatus() : pulseStatus(site.id),
      // Experimental connections stay invisible to a household without them, even with credentials still stored
      integrations: (experimental ? ints : ints.filter((i) => !isExperimentalProvider(i.provider))).map(({ provider, status }) => ({ provider, status })),
    },
    // Around the house on Home: whether there are lights, cameras and air conditioners to show, the last ring at the door,
    // and for the owner the morning music's speakers, music and volume, which the music button starts from
    around: experimental
      ? {
          lights: !!ints.find((i) => i.provider === 'hue')?.meta.authorized,
          security: !!ints.find((i) => i.provider === 'nest')?.meta.authorized,
          doorbell: lastRing(ints.find((i) => i.provider === 'nest')?.meta ?? {}),
          airco: ints.some((i) => i.provider === 'midea'),
          music: role === 'owner' ? homeMusic(ints.find((i) => i.provider === 'sonos')?.meta) : null,
        }
      : null,
  }
})

function homeMusic(meta: Record<string, unknown> | undefined) {
  if (!meta?.authorized) return null
  const { players, source, volume } = morningSettings(meta)
  return { speakers: players.map((p) => p.name), source, volume }
}
