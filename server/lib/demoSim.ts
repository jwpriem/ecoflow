import { feedInPrice } from './feedin'
import { buildPlan } from './strategy'
import { addMs, SLOT_MS, startOfLocalDay } from './time'
import type { BatteryMode, PriceSlot, StrategyConfig } from './types'

/**
 * The demo household's days (JER-40): prices, weather, solar, house load and what two STREAM Pro units do with
 * them, worked out from the date alone, so the same day always looks the same (reproducible screenshots).
 * Pure: services/demoData writes it to the database, the real ledger books it.
 */

export const DEMO_STEP_MS = 5 * 60_000
/** Two STREAM Pro units working as one system */
export const DEMO_SYSTEM = { capacityWh: 2 * 1920, maxChargeW: 2 * 1200, maxOutputW: 800, units: 2 } as const
/** A 3.6 kWp roof near Utrecht */
const PEAK_KW = 3.6
const LAT = 52.1
const LON = 5.1
const ETA_IN = 0.95
const ETA_OUT = 0.95

/** Small, fast, seeded random numbers (mulberry32): the same seed gives the same sequence */
export function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
  let a = (h << 13) | (h >>> 19)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The local calendar date of a moment, as YYYY-MM-DD */
export function localDateKey(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

const dayOfYear = (d: Date) => Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000)
const fracHour = (d: Date, timeZone: string) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':').map(Number)
  return h! + m! / 60
}

/** Clear-sky irradiance on flat ground, W/m², from the sun's height (no equation of time: close enough for a demo) */
function clearSkyGhi(t: Date) {
  const decl = (23.44 * Math.PI) / 180 * Math.sin((2 * Math.PI * (284 + dayOfYear(t))) / 365)
  const solarHour = t.getUTCHours() + t.getUTCMinutes() / 60 + LON / 15
  const hourAngle = ((solarHour - 12) * 15 * Math.PI) / 180
  const lat = (LAT * Math.PI) / 180
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  return sinEl > 0 ? 1000 * 0.9 * Math.pow(sinEl, 1.15) : 0
}

export type DemoPrice = PriceSlot & { tax: number; feedIn: number }

export interface DemoDay {
  date: string
  /** One per 15-min slot of the local day (92 or 100 on the DST days) */
  prices: DemoPrice[]
  /** Global horizontal irradiance per slot, W/m² (also the "forecast" for the plan) */
  ghi: number[]
  /** Average solar production per slot, W */
  solarSlotW: number[]
  /** Every 5 minutes: house load, solar and what the batteries did (+ charging) */
  points: { ts: Date; loadW: number; solarW: number; batteryW: number; soc: number; gridW: number; mode: BatteryMode }[]
  /** The plan the day ran on, per slot */
  actions: BatteryMode[]
}

/** The weather, prices and load of a day: the same for every call with the same date */
export function demoInputs(date: string, timeZone: string, feedIn: StrategyConfig['feedIn']) {
  const start = startOfLocalDay(new Date(`${date}T12:00:00Z`), timeZone)
  const end = startOfLocalDay(addMs(start, 36 * 3600_000), timeZone)
  const rnd = seededRandom(`demo:${date}`)
  const month = Number(date.slice(5, 7))
  const summer = Math.cos(((month - 6.5) / 12) * 2 * Math.PI) // 1 in June/July, -1 in December/January
  const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())
  const cloud = Math.pow(rnd(), 0.7) // 0 clear .. 1 overcast, more often cloudy than not
  const base = 0.09 - 0.015 * summer + (rnd() - 0.5) * 0.04 - (weekend ? 0.015 : 0)

  const slots: Date[] = []
  for (let t = start; t < end; t = addMs(t, SLOT_MS)) slots.push(t)
  const hourCloud = Array.from({ length: 25 }, () => Math.min(1, Math.max(0, cloud + (rnd() - 0.5) * 0.3)))
  const ghi = slots.map((t) => {
    const h = Math.floor(fracHour(t, timeZone))
    return Math.round(clearSkyGhi(addMs(t, SLOT_MS / 2)) * (1 - 0.75 * hourCloud[h]!))
  })
  const solarSlotW = ghi.map((g) => Math.round(g * PEAK_KW * 0.82 * (0.95 + rnd() * 0.1)))
  const prices: DemoPrice[] = slots.map((slotStart, i) => {
    const h = fracHour(slotStart, timeZone)
    const shape =
      (h < 6 ? -0.03 : 0) +
      (h >= 7 && h < 9 ? 0.045 : 0) +
      (h >= 17 && h < 21 ? 0.09 : 0) +
      (h >= 21 ? 0.015 : 0) -
      // Solar pushes the midday price down on sunny days, most in summer
      (ghi[i]! / 1000) * (0.05 + 0.04 * summer)
    const energy = Math.round((base + shape + (rnd() - 0.5) * 0.012) * 10000) / 10000
    // Energy tax 2026, Tibber's purchase fee and VAT
    const total = Math.round((energy + 0.1016 + 0.0181) * 1.21 * 10000) / 10000
    return { slotStart, energy, total, tax: Math.round((total - energy) * 10000) / 10000, feedIn: feedInPrice(slotStart, energy, total, feedIn, timeZone) }
  })
  return { start, end, slots, prices, ghi, solarSlotW, cloud, rnd, summer }
}

/** House load (without batteries) at a moment: a quiet base, breakfast, cooking and evening, plus the odd kettle */
function loadW(t: Date, timeZone: string, rnd: () => number, summer: number) {
  const h = fracHour(t, timeZone)
  let w = 230 - 60 * summer
  if (h >= 6.75 && h < 8.5) w += 450
  if (h >= 12 && h < 13) w += 200
  if (h >= 17 && h < 19) w += 900
  else if (h >= 19 && h < 22.5) w += 450
  if (rnd() < 0.06) w += 1200 + rnd() * 800
  return Math.round(w * (0.9 + rnd() * 0.2))
}

/**
 * One day of the demo household, starting at `startSoc` (0-1). The batteries follow the real planner (buildPlan,
 * fed the day's prices and solar), the way the STREAM does it: self-use covers the house up to the system's
 * 800 W, solar surplus fills it, a grid charge charges at full power.
 */
export function simulateDemoDay(date: string, startSoc: number, cfg: StrategyConfig, timeZone = 'Europe/Amsterdam'): DemoDay {
  const inp = demoInputs(date, timeZone, cfg.feedIn)
  const next = demoInputs(localDateKey(inp.end, timeZone), timeZone, cfg.feedIn)
  const capKwh = DEMO_SYSTEM.capacityWh / 1000
  // Planned at midnight with today's and tomorrow's prices, as the app would after tomorrow's came in
  const plan = buildPlan({
    prices: [...inp.prices, ...next.prices],
    solarW: [...inp.solarSlotW, ...next.solarSlotW],
    storedKwh: startSoc * capKwh,
    capacityKwh: capKwh,
    maxChargeW: DEMO_SYSTEM.maxChargeW,
    maxDischargeW: DEMO_SYSTEM.maxOutputW,
    poolAvgCost: 0.2,
    cfg: { ...cfg, maxOutputW: DEMO_SYSTEM.maxOutputW },
    timeZone,
  })
  const actions = inp.slots.map((_, i) => plan[i]?.action ?? 'self_use')

  let soc = startSoc
  const points: DemoDay['points'] = []
  const dtH = DEMO_STEP_MS / 3600_000
  for (let t = inp.start; t < inp.end; t = addMs(t, DEMO_STEP_MS)) {
    const i = Math.floor((t.getTime() - inp.start.getTime()) / SLOT_MS)
    const mode = actions[i]!
    const solarW = Math.max(0, Math.round(inp.solarSlotW[i]! * (0.9 + inp.rnd() * 0.2)))
    const load = loadW(t, timeZone, inp.rnd, inp.summer)
    const net = load - solarW
    const roomW = ((cfg.maxSoc - soc) * capKwh * 1000) / dtH / ETA_IN
    const availW = (Math.max(0, soc - cfg.reserveSoc) * capKwh * 1000 * ETA_OUT) / dtH
    let batteryW = 0
    if (mode === 'charge_grid') batteryW = Math.min(DEMO_SYSTEM.maxChargeW, roomW)
    else if (net < 0) batteryW = Math.min(-net, DEMO_SYSTEM.maxChargeW, roomW)
    else if (mode !== 'solar_only') batteryW = -Math.min(net, DEMO_SYSTEM.maxOutputW, availW)
    batteryW = Math.round(batteryW)
    soc += batteryW > 0 ? (batteryW * ETA_IN * dtH) / (capKwh * 1000) : (batteryW / ETA_OUT) * dtH / (capKwh * 1000)
    soc = Math.min(1, Math.max(0, soc))
    points.push({ ts: t, loadW: load, solarW, batteryW, soc: Math.round(soc * 1000) / 1000, gridW: net + batteryW, mode })
  }
  return { date, prices: inp.prices, ghi: inp.ghi, solarSlotW: inp.solarSlotW, points, actions }
}

/**
 * A day with the charge level it would have at midnight: the day before is run from half full first. The
 * planner empties and fills the batteries every day, so that start differs little from the real evening before.
 */
export function demoDay(date: string, cfg: StrategyConfig, timeZone = 'Europe/Amsterdam'): DemoDay {
  const prev = localDateKey(addMs(startOfLocalDay(new Date(`${date}T12:00:00Z`), timeZone), -12 * 3600_000), timeZone)
  const before = simulateDemoDay(prev, 0.5, cfg, timeZone)
  return simulateDemoDay(date, before.points.at(-1)!.soc, cfg, timeZone)
}
