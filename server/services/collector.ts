import type { Db } from '../db/client'
import { samples, type sites } from '../db/schema'
import { pulseGridW } from '../providers/tibberPulse'
import { readEcoFlow } from './ecoflow'
import { solarEdgeSolarW } from './solaredge'
import { runSurplus } from './strategy'

type Site = typeof sites.$inferSelect
export type HouseSource = 'pulse'

export interface LiveState {
  ts: string
  /** The household without the batteries (+ import, - surplus); null without a meter */
  houseNetW: number | null
  gridW: number | null
  solarW: number | null
  houseSource: HouseSource | null
  solarSource: 'solaredge' | null
}
const live = new Map<number, LiveState>()
export const liveState = (siteId: number) => live.get(siteId)
export const forgetLive = (siteId: number) => live.delete(siteId)
/** For the demo household, whose readings come from the demo generator instead of a collection tick */
export const setLive = (siteId: number, state: LiveState) => live.set(siteId, state)

/**
 * One collection tick: read the batteries (EcoFlow), the meter (Tibber Pulse) and solar (SolarEdge) and store samples.
 * The Pulse measures the real grid power with the batteries in it; the house without batteries is that minus the batteries.
 * A source that is not connected is simply left out.
 */
export async function collect(db: Db, site: Site, key: string, now = new Date()): Promise<LiveState> {
  const realSolarW = await solarEdgeSolarW(db, site, key, now)
  const pulse = pulseGridW(site.id)
  const batteries = await readEcoFlow(db, site, key, now)

  let batteryW = 0
  const sampleRows: (typeof samples.$inferInsert)[] = []
  for (const b of batteries) {
    batteryW += b.state.powerW ?? 0
    sampleRows.push({ siteId: site.id, deviceId: b.deviceId, ts: now, kind: 'battery', powerW: b.state.powerW ?? 0, soc: b.state.soc ?? null, pvW: b.state.pvW ?? 0 })
  }
  const gridW = pulse ?? null
  if (gridW !== null) sampleRows.push({ siteId: site.id, ts: now, kind: 'grid', powerW: gridW })
  const solarW = realSolarW ?? null
  if (solarW !== null) sampleRows.push({ siteId: site.id, ts: now, kind: 'solar', powerW: solarW })
  if (sampleRows.length) await db.insert(samples).values(sampleRows)

  const state: LiveState = {
    ts: now.toISOString(),
    houseNetW: gridW === null ? null : gridW - batteryW,
    gridW,
    solarW,
    houseSource: gridW === null ? null : 'pulse',
    solarSource: solarW === null ? null : 'solaredge',
  }
  live.set(site.id, state)

  if (batteries.length) {
    const socs = batteries.map((b) => b.state.soc).filter((v): v is number => typeof v === 'number')
    const maxChg = batteries.map((b) => Number(b.state.quota?.cmsMaxChgSoc)).filter((v) => Number.isFinite(v) && v > 0)
    try {
      await runSurplus(db, site, key, {
        gridW: gridW ?? undefined,
        batteryW,
        socPct: socs.length ? (socs.reduce((a, b) => a + b, 0) / socs.length) * 100 : 100,
        maxChgPct: maxChg.length ? Math.max(...maxChg) : 100,
      }, now)
    } catch (err) {
      console.error(`[surplus] site ${site.id}:`, (err as Error).message)
    }
  }
  return state
}
