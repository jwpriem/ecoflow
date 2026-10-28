import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { devices, type sites } from '../db/schema'
import { batteryModel } from '../lib/batteryModels'
import type { BatteryMode } from '../lib/types'
import {
  backupReserveFor,
  deviceQuota,
  type DeviceState,
  type EcoFlowCredentials,
  listDevices,
  parseStreamQuota,
  type RequestOptions,
  setStreamConfig,
  shareSystemReading,
  type StreamReading,
  streamDevices,
} from '../providers/ecoflow'
import { ecoflowMqttStatus, mqttQuota, startEcoFlowMqtt, stopEcoFlowMqtt } from '../providers/ecoflow/mqtt'
import { getIntegration, markIntegration, updateIntegration } from './integrations'

type Site = typeof sites.$inferSelect

async function credentials(db: Db, site: Site, key: string) {
  const integ = await getIntegration<EcoFlowCredentials>(db, site.id, 'ecoflow_official', key)
  if (!integ) return null
  const opts: RequestOptions = { host: (integ.meta.host as string | undefined) || undefined }
  return { ...integ, opts }
}

/**
 * Test the developer API keys and make sure every STREAM unit on the account is a device row.
 * Units are matched on serial number; settings like name and capacity are kept on later syncs.
 */
export async function syncEcoFlowDevices(db: Db, site: Site, key: string): Promise<{ error?: string; count: number }> {
  const integ = await credentials(db, site, key)
  if (!integ) return { count: 0 }
  try {
    const list = streamDevices(await listDevices(integ.creds, integ.opts))
    if (!list.length) throw new Error('No devices on this EcoFlow account')
    const existing = await db.select().from(devices).where(eq(devices.siteId, site.id))
    for (const d of list) {
      if (existing.some((e) => e.serial === d.sn)) continue
      const model = d.productName || 'STREAM Pro'
      const spec = batteryModel(model)
      await db.insert(devices).values({
        siteId: site.id,
        driver: 'ecoflow_official',
        serial: d.sn,
        name: d.deviceName || d.productName || d.sn,
        model,
        capacityWh: spec.capacityWh,
        maxChargeW: spec.maxChargeW,
        maxDischargeW: spec.maxDischargeW,
      })
    }
    const meta = {
      ...integ.meta,
      devices: list.map((d) => ({ sn: d.sn, name: d.deviceName ?? null, product: d.productName ?? null, online: d.online === 1 })),
      lastSync: new Date().toISOString(),
    }
    await updateIntegration(db, integ.row.id, { meta }, key)
    await markIntegration(db, integ.row.id)
    await syncEcoFlowMqtt(site.id, integ.creds, list.map((d) => d.sn), integ.opts)
    return { count: list.length }
  } catch (err) {
    const error = (err as Error).message
    await markIntegration(db, integ.row.id, error)
    return { error, count: 0 }
  }
}

/** (Re)start the MQTT stream; a failure only costs the per-unit pack values, so it is logged, not raised */
async function syncEcoFlowMqtt(siteId: number, creds: EcoFlowCredentials, serials: string[], opts: RequestOptions) {
  try {
    await startEcoFlowMqtt(siteId, creds, serials, opts)
  } catch (err) {
    stopEcoFlowMqtt(siteId)
    console.warn(`[ecoflow-mqtt] site ${siteId}: ${(err as Error).message}`)
  }
}

export interface BatteryReading {
  deviceId: number
  state: DeviceState
}

/** Read every EcoFlow battery of the site. A unit that fails is left out; the integration status shows the error. */
export async function readEcoFlow(db: Db, site: Site, key: string, now = new Date()): Promise<BatteryReading[]> {
  const rows = await db
    .select()
    .from(devices)
    .where(and(eq(devices.siteId, site.id), eq(devices.driver, 'ecoflow_official')))
  if (!rows.length) return []
  const integ = await credentials(db, site, key)
  if (!integ) return []

  const read: { device: (typeof rows)[number]; capacityWh: number; reading: StreamReading; quota: Record<string, unknown> }[] = []
  const errors: string[] = []
  for (const d of rows) {
    try {
      // REST has the system values; MQTT adds the per-pack keys REST leaves out (REST wins where both have a key)
      const quota = { ...mqttQuota(site.id, d.serial), ...(await deviceQuota(integ.creds, d.serial, integ.opts)) }
      read.push({ device: d, capacityWh: d.capacityWh, reading: parseStreamQuota(quota), quota })
    } catch (err) {
      errors.push(`${d.name}: ${(err as Error).message}`)
    }
  }

  const out: BatteryReading[] = []
  const mqtt = ecoflowMqttStatus(site.id)
  for (const { device: d, reading: r, quota } of shareSystemReading(read)) {
    const prev = d.state as DeviceState
    const state: DeviceState = {
      ...prev,
      soc: r.soc ?? prev.soc,
      powerW: r.powerW,
      pvW: r.pvW,
      online: true,
      ts: now.toISOString(),
      quota,
      mqtt: { connected: mqtt.connected, error: mqtt.error ?? null, ...(mqtt.units?.[d.serial] ?? {}), lastGetReply: mqtt.lastGetReply ?? null, raw: mqtt.raw ?? null },
    }
    await db.update(devices).set({ state: state as Record<string, unknown> }).where(eq(devices.id, d.id))
    out.push({ deviceId: d.id, state })
  }
  await markIntegration(db, integ.row.id, errors.length ? errors.join('; ') : undefined)
  return out
}

/** Who steers the STREAM: EcoFlow's own AI mode, or WattsWise through the backup reserve (Self-Powered mode) */
export type EcoFlowSteering = 'ecoflow_ai' | 'wattwise'

export function steeringOf(meta: Record<string, unknown> | undefined): EcoFlowSteering {
  return meta?.steering === 'wattwise' ? 'wattwise' : 'ecoflow_ai'
}

/** The unit that takes settings for the whole system: the one reporting MASTER, else the one with system values */
async function mainUnit(db: Db, site: Site) {
  const rows = await db
    .select()
    .from(devices)
    .where(and(eq(devices.siteId, site.id), eq(devices.driver, 'ecoflow_official')))
  const quota = (d: (typeof rows)[number]) => (d.state as DeviceState).quota ?? {}
  return (
    rows.find((d) => quota(d).distributedDeviceStatus === 'MASTER') ??
    rows.find((d) => Number(quota(d).cmsBattSoc) > 0) ??
    rows[0]
  )
}

const operateMode = (steering: EcoFlowSteering) =>
  steering === 'wattwise' ? { operateSelfPoweredOpen: true } : { operateIntelligentScheduleModeOpen: true }

/** Switch the system between EcoFlow AI and WattsWise. Returns an error message, or nothing when it worked. */
export async function setEcoFlowSteering(db: Db, site: Site, key: string, steering: EcoFlowSteering): Promise<string | undefined> {
  const integ = await credentials(db, site, key)
  if (!integ) return 'EcoFlow developer API is not connected'
  const main = await mainUnit(db, site)
  if (!main) return 'No STREAM units found'
  try {
    await setStreamConfig(integ.creds, main.serial, { cfgEnergyStrategyOperateMode: operateMode(steering) }, integ.opts)
    await updateIntegration(db, integ.row.id, { meta: { ...integ.meta, steering } }, key)
    return undefined
  } catch (err) {
    return (err as Error).message
  }
}

/**
 * Apply one plan mode to the STREAM system. Only when WattsWise steers; with EcoFlow AI nothing is sent.
 * Returns what to put in the command log.
 */
export async function controlEcoFlow(db: Db, site: Site, key: string, mode: BatteryMode): Promise<string> {
  const integ = await credentials(db, site, key)
  if (!integ) return 'skipped: EcoFlow developer API not connected'
  if (steeringOf(integ.meta) !== 'wattwise') return 'skipped: EcoFlow AI mode steers the batteries'
  const main = await mainUnit(db, site)
  if (!main) return 'skipped: no STREAM units'
  const q = (main.state as DeviceState).quota ?? {}
  const n = (k: string, d: number) => (Number.isFinite(Number(q[k])) && q[k] !== null && q[k] !== undefined ? Number(q[k]) : d)
  const reserve = backupReserveFor(mode, {
    socPct: n('cmsBattSoc', 0),
    reservePct: site.strategy.reserveSoc * 100,
    targetPct: site.strategy.maxSoc * 100,
    minDsgPct: n('cmsMinDsgSoc', 0),
    maxChgPct: n('cmsMaxChgSoc', 100),
  })
  try {
    // The app (or a reset) may have switched AI mode back on; WattsWise only works in Self-Powered mode
    const switchMode = q['energyStrategyOperateMode.operateSelfPoweredOpen'] === false
    if (switchMode) await setStreamConfig(integ.creds, main.serial, { cfgEnergyStrategyOperateMode: operateMode('wattwise') }, integ.opts)
    await setStreamConfig(integ.creds, main.serial, { cfgBackupReverseSoc: reserve }, integ.opts)
    return `ok: backup reserve ${reserve}%${switchMode ? ', switched to Self-Powered mode' : ''}`
  } catch (err) {
    return `error: ${(err as Error).message}`
  }
}
