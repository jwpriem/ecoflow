import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { devices, samples, type sites } from '../db/schema'
import { fakeLoadW, fakeSolarW } from '../lib/fake'
import { mockDriver } from '../providers/ecoflow'
import { pulseGridW } from '../providers/tibberPulse'
import { solarEdgeSolarW } from './solaredge'

type Site = typeof sites.$inferSelect
export type HouseSource = 'pulse' | 'fake'

export interface LiveState {
  ts: string
  houseNetW: number
  gridW: number
  solarW: number | null
  houseSource: HouseSource
  solarSource: 'solaredge' | 'fake' | null
}
const live = new Map<number, LiveState>()
export const liveState = (siteId: number) => live.get(siteId)

/**
 * One collection tick: work out the household's net power, advance/read the batteries and store samples.
 * With fake batteries the Pulse reading is the house without batteries; the simulated batteries are added on top.
 */
export async function collect(db: Db, site: Site, key: string, now = new Date()): Promise<LiveState> {
  const realSolarW = await solarEdgeSolarW(db, site, key, now)
  const pulse = pulseGridW(site.id)

  // SolarEdge v2 only reports production, so without the Pulse the household load is synthetic
  const solarW = realSolarW ?? (pulse === undefined ? fakeSolarW(now, site.timezone) : null)
  const solarSource = realSolarW !== undefined ? 'solaredge' : pulse === undefined ? 'fake' : null
  let houseNetW: number
  let houseSource: HouseSource
  if (pulse !== undefined) {
    houseNetW = pulse
    houseSource = 'pulse'
  } else {
    houseNetW = fakeLoadW(now, site.timezone) - solarW!
    houseSource = 'fake'
  }

  const rows = await db.select().from(devices).where(eq(devices.siteId, site.id))
  const mocks = rows.filter((d) => d.driver === 'mock')
  const limits = {
    reserveSoc: site.strategy.reserveSoc,
    maxSoc: site.strategy.maxSoc,
    legEfficiency: Math.sqrt(site.strategy.roundTripEfficiency),
  }
  const states = mocks.length ? mockDriver.step(mocks, houseNetW, now, limits) : []
  // Real EcoFlow drivers will be read here once phase 0 is done.

  let batteryW = 0
  const sampleRows: (typeof samples.$inferInsert)[] = []
  for (const [i, d] of mocks.entries()) {
    const s = states[i]!
    batteryW += s.powerW
    await db.update(devices).set({ state: s as unknown as Record<string, unknown> }).where(eq(devices.id, d.id))
    sampleRows.push({ siteId: site.id, deviceId: d.id, ts: now, kind: 'battery', powerW: s.powerW, soc: s.soc, pvW: s.pvW })
  }
  const gridW = houseNetW + batteryW
  sampleRows.push({ siteId: site.id, ts: now, kind: 'grid', powerW: gridW })
  if (solarW !== null) sampleRows.push({ siteId: site.id, ts: now, kind: 'solar', powerW: solarW })
  await db.insert(samples).values(sampleRows)

  const state: LiveState = { ts: now.toISOString(), houseNetW, gridW, solarW, houseSource, solarSource }
  live.set(site.id, state)
  return state
}
