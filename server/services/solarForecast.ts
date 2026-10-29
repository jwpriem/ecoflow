import { and, eq, gte, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { integrations, irradiance, type sites, solarProduction } from '../db/schema'
import { changed } from '../db/upsert'
import { forecastLocation } from '../lib/location'
import { defaultFactor, expectedSolarW, FORECAST_DAYS, FORECAST_PAST_DAYS, fitFactor } from '../lib/solarForecast'
import { openMeteoIrradiance } from '../providers/openMeteo'

type Site = typeof sites.$inferSelect

// Households in the same 0.1° square share one call per run: the hourly job asks for each in turn
const FETCH_TTL_MS = 20 * 60_000
const fetches = new Map<string, { at: number; rows: ReturnType<typeof openMeteoIrradiance> }>()

function irradianceAt(lat: number, lon: number) {
  const key = `${lat},${lon}`
  const hit = fetches.get(key)
  if (hit && Date.now() - hit.at < FETCH_TTL_MS) return hit.rows
  const rows = openMeteoIrradiance(lat, lon, { pastDays: FORECAST_PAST_DAYS, forecastDays: FORECAST_DAYS })
  fetches.set(key, { at: Date.now(), rows })
  // A failed call is not kept: the next household or run tries again
  rows.catch(() => fetches.delete(key))
  return rows
}

/** Forget the shared calls (tests, or after a household moved) */
export const resetIrradianceFetches = () => fetches.clear()

/** Fetch past and forecast irradiance for the household's location (one free call, shared nearby) and keep it per slot */
export async function refreshIrradiance(db: Db, site: Site): Promise<number> {
  const { lat, lon } = forecastLocation(site.location)
  const rows = await irradianceAt(lat, lon)
  if (!rows.length) return 0
  const now = new Date()
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(irradiance)
      .values(rows.slice(i, i + 1000).map((r) => ({ siteId: site.id, slotStart: r.slotStart, ghi: r.ghi, updatedAt: now })))
      .onConflictDoUpdate({
        target: [irradiance.siteId, irradiance.slotStart],
        set: { ghi: sql.raw('excluded.ghi'), updatedAt: now },
        // Each hourly call returns weeks of slots, almost all as before
        setWhere: changed('irradiance', ['ghi']),
      })
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

// The fit moves only as new quarter-hours come in, but Home asks for the forecast every 30 seconds
const FACTOR_TTL_MS = 15 * 60_000
const factorCache = new Map<number, { at: number; value: Promise<Awaited<ReturnType<typeof solarFactor>>> }>()

function cachedSolarFactor(db: Db, site: Site) {
  const hit = factorCache.get(site.id)
  if (hit && Date.now() - hit.at < FACTOR_TTL_MS) return hit.value
  const value = solarFactor(db, site)
  factorCache.set(site.id, { at: Date.now(), value })
  // A failed fit is not kept: the next call tries again
  value.catch(() => factorCache.delete(site.id))
  return value
}

/** Expected solar production in W per slot start (ms) */
export async function solarForecastW(db: Db, site: Site, from: Date, to: Date): Promise<Map<number, number>> {
  const [rows, { factor, peakPowerKw: peak }] = await Promise.all([
    db
      .select()
      .from(irradiance)
      .where(and(eq(irradiance.siteId, site.id), gte(irradiance.slotStart, from), lt(irradiance.slotStart, to))),
    cachedSolarFactor(db, site),
  ])
  if (!rows.length) return new Map()
  return new Map(rows.map((r) => [r.slotStart.getTime(), expectedSolarW(r.ghi, factor, peak)]))
}
