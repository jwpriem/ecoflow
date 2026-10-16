/**
 * Synthetic but plausible Dutch data, used for seeding history and when no real source is connected.
 * Deterministic for a given time so restarts and re-seeds look the same.
 */
import { localHour } from './time'

function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x) // 0..1
}

/** Day-ahead-like price: cheap at night and midday (solar), peaks around 8:00 and 19:00. EUR/kWh incl. tax. */
export function fakePrice(slotStart: Date, timeZone = 'Europe/Amsterdam') {
  const h = localHour(slotStart, timeZone)
  const day = Math.floor(slotStart.getTime() / 86_400_000)
  const dow = new Date(slotStart).getUTCDay()
  const weekend = dow === 0 || dow === 6 ? -0.015 : 0
  const morning = 0.07 * Math.exp(-((h - 8) ** 2) / 2)
  const evening = 0.11 * Math.exp(-((h - 19) ** 2) / 3)
  const solarDip = -0.06 * Math.exp(-((h - 13.5) ** 2) / 6)
  const dayLevel = (noise(day) - 0.5) * 0.05
  const jitter = (noise(slotStart.getTime() / 900_000) - 0.5) * 0.012
  const energy = Math.max(-0.02, 0.085 + morning + evening + solarDip + weekend + dayLevel + jitter)
  const tax = 0.1316 // energy tax + VAT part, roughly NL 2026
  const total = Math.round((energy * 1.21 + tax) * 10000) / 10000
  return { energy: Math.round(energy * 10000) / 10000, tax, total }
}

/** Household consumption in W */
export function fakeLoadW(t: Date, timeZone = 'Europe/Amsterdam'): number {
  const h = localHour(t, timeZone)
  const base = 220
  const morning = 450 * Math.exp(-((h - 7.5) ** 2) / 1.5)
  const evening = 900 * Math.exp(-((h - 18.5) ** 2) / 2.5)
  const spike = noise(Math.floor(t.getTime() / 300_000)) > 0.93 ? 1800 : 0 // kettle, oven, ...
  return base + morning + evening + spike + noise(t.getTime() / 60_000) * 80
}

/** Solar production in W for a ~4 kWp system, scaled by season and a cloudiness factor per day */
export function fakeSolarW(t: Date, timeZone = 'Europe/Amsterdam', peakW = 3600): number {
  const h = localHour(t, timeZone)
  const doy = Math.floor((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000)
  const season = 0.55 + 0.45 * Math.cos(((doy - 172) / 365) * 2 * Math.PI) // 1 in June, ~0.1 in Dec
  const dayLen = 8 + 8.5 * season
  const sunrise = 13.5 - dayLen / 2
  const x = (h - sunrise) / dayLen
  if (x <= 0 || x >= 1) return 0
  const clouds = 0.35 + 0.65 * noise(Math.floor(t.getTime() / 86_400_000) + 7)
  const flicker = 0.8 + 0.2 * noise(Math.floor(t.getTime() / 600_000))
  return Math.max(0, peakW * season * Math.sin(Math.PI * x) ** 1.5 * clouds * flicker)
}
