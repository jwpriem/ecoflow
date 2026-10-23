import { and, eq, gte, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { integrations, irradiance, type sites, solarProduction } from '../db/schema'
import { defaultFactor, expectedSolarW, FORECAST_DAYS, FORECAST_PAST_DAYS, fitFactor, SOLAR_LOCATION } from '../lib/solarForecast'
import { openMeteoIrradiance } from '../providers/openMeteo'

type Site = typeof sites.$inferSelect

/** Fetch past and forecast irradiance (one free call) and keep it per slot */
export async function refreshIrradiance(db: Db, site: Site): Promise<number> {
  const rows = await openMeteoIrradiance(SOLAR_LOCATION.lat, SOLAR_LOCATION.lon, { pastDays: FORECAST_PAST_DAYS, forecastDays: FORECAST_DAYS })
  if (!rows.length) return 0
  const now = new Date()
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(irradiance)
      .values(rows.slice(i, i + 1000).map((r) => ({ siteId: site.id, slotStart: r.slotStart, ghi: r.ghi, updatedAt: now })))
      .onConflictDoUpdate({ target: [irradiance.siteId, irradiance.slotStart], set: { ghi: sql.raw('excluded.ghi'), updatedAt: now } })
  }
  return rows.length
}

async function peakPowerKw(db: Db, siteId: number): Promise<number | undefined> {
  const [row] = await db
    .select({ meta: integrations.meta })
    .from(integrations)
    .where(and(eq(integrations.siteId, siteId), eq(integrations.provider, 'solaredge')))
  const p = Number((row?.meta.lastTest as { peakPower?: number } | undefined)?.peakPower)
  return Number.isFinite(p) && p > 0 ? p : undefined
}

/** W produced per W/m², fitted on the last weeks of SolarEdge history */
export async function solarFactor(db: Db, site: Site, now = new Date()) {
  const peak = await peakPowerKw(db, site.id)
  const since = new Date(now.getTime() - FORECAST_PAST_DAYS * 86_400_000)
  const pairs = await db
    .select({ ghi: irradiance.ghi, w: solarProduction.avgW })
    .from(solarProduction)
    .innerJoin(irradiance, and(eq(irradiance.siteId, solarProduction.siteId), eq(irradiance.slotStart, solarProduction.slotStart)))
    .where(and(eq(solarProduction.siteId, site.id), gte(solarProduction.slotStart, since)))
  return { ...fitFactor(pairs, defaultFactor(peak)), peakPowerKw: peak }
}

/** Expected solar production in W per slot start (ms) */
export async function solarForecastW(db: Db, site: Site, from: Date, to: Date): Promise<Map<number, number>> {
  const rows = await db
    .select()
    .from(irradiance)
    .where(and(eq(irradiance.siteId, site.id), gte(irradiance.slotStart, from), lt(irradiance.slotStart, to)))
  if (!rows.length) return new Map()
  const { factor, peakPowerKw: peak } = await solarFactor(db, site)
  return new Map(rows.map((r) => [r.slotStart.getTime(), expectedSolarW(r.ghi, factor, peak)]))
}
