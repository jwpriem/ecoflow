import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { devices, samples, type sites } from '../db/schema'
import { fakeLoadW, fakeSolarW } from '../lib/fake'
import { mockDriver } from '../providers/ecoflow'
import { solarEdgePowerFlow, type PowerFlow, type SolarEdgeCredentials } from '../providers/solaredge'
import { pulseGridW } from '../providers/tibberPulse'
import { getIntegration, markIntegration } from './integrations'

type Site = typeof sites.$inferSelect
export type HouseSource = 'pulse' | 'solaredge' | 'fake'

// SolarEdge allows 300 calls/day per site: poll at most every 6 minutes (240/day)
const SOLAREDGE_TTL_MS = 6 * 60_000
const solarEdgeCache = new Map<number, { at: number; flow?: PowerFlow }>()

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

async function solarEdgeFlow(db: Db, siteId: number, key: string): Promise<PowerFlow | undefined> {
  const cached = solarEdgeCache.get(siteId)
  if (cached && Date.now() - cached.at < SOLAREDGE_TTL_MS) return cached.flow
  const se = await getIntegration<SolarEdgeCredentials>(db, siteId, 'solaredge', key)
  if (!se) return undefined
  try {
    const flow = await solarEdgePowerFlow(se.creds)
    solarEdgeCache.set(siteId, { at: Date.now(), flow })
    await markIntegration(db, se.row.id)
    return flow
  } catch (err) {
    solarEdgeCache.set(siteId, { at: Date.now(), flow: cached?.flow })
    await markIntegration(db, se.row.id, (err as Error).message)
    return cached?.flow
  }
}

/**
 * One collection tick: work out the household's net power, advance/read the batteries and store samples.
 * With fake batteries the Pulse reading is the house without batteries; the simulated batteries are added on top.
 */
export async function collect(db: Db, site: Site, key: string, now = new Date()): Promise<LiveState> {
  const flow = await solarEdgeFlow(db, site.id, key)
  const pulse = pulseGridW(site.id)

  let houseNetW: number
  let houseSource: HouseSource
  if (pulse !== undefined) {
    houseNetW = pulse
    houseSource = 'pulse'
  } else if (flow) {
    houseNetW = flow.loadW - flow.pvW
    houseSource = 'solaredge'
  } else {
    houseNetW = fakeLoadW(now, site.timezone) - fakeSolarW(now, site.timezone)
    houseSource = 'fake'
  }
  const solarW = flow ? flow.pvW : houseSource === 'fake' ? fakeSolarW(now, site.timezone) : null
  const solarSource = flow ? 'solaredge' : houseSource === 'fake' ? 'fake' : null

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
