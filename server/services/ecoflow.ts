import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { devices, type sites } from '../db/schema'
import {
  deviceQuota,
  type DeviceState,
  type EcoFlowCredentials,
  listDevices,
  parseStreamQuota,
  type RequestOptions,
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
      await db.insert(devices).values({
        siteId: site.id,
        driver: 'ecoflow_official',
        serial: d.sn,
        name: d.deviceName || d.productName || d.sn,
        model: d.productName || 'STREAM Pro',
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
      mqtt: { connected: mqtt.connected, error: mqtt.error ?? null, ...(mqtt.units?.[d.serial] ?? {}), lastGetReply: mqtt.lastGetReply ?? null },
    }
    await db.update(devices).set({ state: state as Record<string, unknown> }).where(eq(devices.id, d.id))
    out.push({ deviceId: d.id, state })
  }
  await markIntegration(db, integ.row.id, errors.length ? errors.join('; ') : undefined)
  return out
}
