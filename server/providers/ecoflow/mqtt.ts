import { randomBytes } from 'node:crypto'
import mqtt, { type MqttClient } from 'mqtt'
import { type EcoFlowCredentials, ecoflowRequest, PACK_KEYS, type RequestOptions } from './index'

/**
 * Official developer MQTT: the same access key + secret give a broker login (certification endpoint).
 * Every unit pushes its full quota on /open/<account>/<sn>/quota, including the per-pack keys
 * (bmsBattSoc, vol, amp, ...) that the REST quota leaves out for the followers of a multi-unit system.
 */
export interface Certification {
  certificateAccount: string
  certificatePassword: string
  url: string
  port: string | number
  protocol?: string
}

export function getCertification(creds: EcoFlowCredentials, opts?: RequestOptions) {
  return ecoflowRequest<Certification>(creds, 'GET', '/iot-open/sign/certification', {}, opts)
}

export const quotaTopic = (account: string, sn: string) => `/open/${account}/${sn}/quota`
export const getTopic = (account: string, sn: string) => `/open/${account}/${sn}/get`
export const getReplyTopic = (account: string, sn: string) => `/open/${account}/${sn}/get_reply`

/** Messages wrap the values as `params`, `param` or `data(.quotaMap)` */
export function quotaFromMessage(raw: Buffer | string): Record<string, unknown> | null {
  let msg: unknown
  try {
    msg = JSON.parse(raw.toString())
  } catch {
    return null
  }
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  const inner = (m.params ?? m.param ?? (m.data as Record<string, unknown> | undefined)?.quotaMap ?? m.data) as unknown
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as Record<string, unknown>
  return null
}

interface UnitState {
  quota: Record<string, unknown>
  lastAt: number
  messages: number
  firstAt: number
}

interface Conn {
  client?: MqttClient
  account?: string
  units: Map<string, UnitState>
  lastGetReply?: { at: number; sn: string; body: string }
  pollTimer?: ReturnType<typeof setInterval>
  stopped: boolean
  error?: string
  subscribedAt?: number
}

const conns = new Map<number, Conn>()

/** Latest values a unit pushed, or undefined when nothing came in within maxAgeMs */
export function mqttQuota(siteId: number, sn: string, maxAgeMs = 20 * 60_000) {
  const u = conns.get(siteId)?.units.get(sn)
  if (!u || Date.now() - u.lastAt > maxAgeMs) return undefined
  return u.quota
}

export function ecoflowMqttStatus(siteId: number) {
  const c = conns.get(siteId)
  if (!c) return { connected: false }
  return {
    connected: !!c.client?.connected,
    error: c.error ?? null,
    subscribedAt: c.subscribedAt ? new Date(c.subscribedAt).toISOString() : null,
    units: Object.fromEntries(
      [...c.units].map(([sn, u]) => [sn, { messages: u.messages, firstAt: new Date(u.firstAt).toISOString(), lastAt: new Date(u.lastAt).toISOString(), keys: Object.keys(u.quota).length }]),
    ),
    lastGetReply: c.lastGetReply ? { ...c.lastGetReply, at: new Date(c.lastGetReply.at).toISOString() } : null,
  }
}

export function stopEcoFlowMqtt(siteId: number) {
  const c = conns.get(siteId)
  if (!c) return
  c.stopped = true
  clearInterval(c.pollTimer)
  c.client?.end(true)
  conns.delete(siteId)
}

/**
 * Connect, subscribe to every unit and ask for the pack keys once a minute (in case pushes slow down
 * while the EcoFlow app is closed). The mqtt client reconnects by itself.
 */
export async function startEcoFlowMqtt(siteId: number, creds: EcoFlowCredentials, serials: string[], opts?: RequestOptions, log = console) {
  stopEcoFlowMqtt(siteId)
  const conn: Conn = { units: new Map(), stopped: false }
  conns.set(siteId, conn)
  const cert = await getCertification(creds, opts)
  if (conn.stopped) return
  const account = cert.certificateAccount
  conn.account = account
  const protocol = cert.protocol === 'mqtt' ? 'mqtt' : 'mqtts'
  const client = mqtt.connect(`${protocol}://${cert.url}:${cert.port}`, {
    username: account,
    password: cert.certificatePassword,
    clientId: `ecoflow-energy-${randomBytes(6).toString('hex')}`,
    reconnectPeriod: 30_000,
    connectTimeout: 20_000,
  })
  conn.client = client

  client.on('connect', () => {
    conn.error = undefined
    // One topic per SUBSCRIBE: the broker refuses a whole packet with one error, which hides which topic it was
    const refused: string[] = []
    for (const topic of serials.flatMap((sn) => [quotaTopic(account, sn), getReplyTopic(account, sn)])) {
      client.subscribe(topic, (err) => {
        if (err) refused.push(`${topic.split('/').slice(-2).join('/')} (${err.message})`)
        conn.error = refused.length ? `subscription refused: ${refused.join(', ')}` : undefined
        conn.subscribedAt = Date.now()
      })
    }
  })
  client.on('message', (topic, payload) => {
    const sn = serials.find((s) => topic.includes(`/${s}/`))
    if (!sn) return
    if (topic.endsWith('/get_reply')) conn.lastGetReply = { at: Date.now(), sn, body: payload.toString().slice(0, 2000) }
    const q = quotaFromMessage(payload)
    if (!q) return
    const now = Date.now()
    const u = conn.units.get(sn) ?? { quota: {}, lastAt: now, messages: 0, firstAt: now }
    Object.assign(u.quota, q)
    u.lastAt = now
    u.messages++
    conn.units.set(sn, u)
  })
  client.on('error', (err) => {
    conn.error = err.message
    log.warn('[ecoflow-mqtt]', err.message)
  })

  let id = 1
  conn.pollTimer = setInterval(() => {
    if (!client.connected) return
    for (const sn of serials) {
      client.publish(getTopic(account, sn), JSON.stringify({ id: id++, version: '1.0', from: 'Android', operateType: 'latestQuotas', params: { quotas: PACK_KEYS } }))
    }
  }, 60_000)
}
