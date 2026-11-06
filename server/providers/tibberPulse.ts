import WebSocket from 'ws'
import { backoffDelay } from '../lib/backoff'
import { tibberUserAgent, tibberWebsocketUrl, type TibberCredentials } from './tibber'

/**
 * Keeps a live Tibber Pulse subscription per site and a short buffer of grid readings.
 * gridW = power (import) - powerProduction (export).
 */
interface Reading {
  ts: number
  gridW: number
}

interface Conn {
  ws?: WebSocket
  buffer: Reading[]
  stopped: boolean
  retry: number
  timer?: ReturnType<typeof setTimeout>
  lastMessageAt: number
  ackAt: number
  /** When this stream was started (boot or new Tibber settings) */
  startedAt: number
}

const conns = new Map<number, Conn>()

/** Reconnects wait 5 s, 10 s, 20 s … up to 5 min, jittered so 200 households don't come back at the same moment */
export const PULSE_BACKOFF = { baseMs: 5_000, maxMs: 300_000 }
/** A connection counts as healthy, and the backoff starts over, after it stayed up this long */
export const PULSE_STABLE_MS = 60_000
/** First connects are spread out by at least this much, so a restart doesn't open every stream at once */
export const PULSE_STAGGER_MS = 1_000
/**
 * A Pulse sends a reading every few seconds. An open connection that stays silent this long is closed and
 * reconnected: Tibber sometimes keeps the socket open without sending anything, which used to go unnoticed for days.
 */
export const PULSE_STALE_MS = 3 * 60_000
let nextStartAt = 0

/** When the next first connect may go: one slot every PULSE_STAGGER_MS */
export function staggerDelay(now = Date.now()): number {
  const at = Math.max(now, nextStartAt)
  nextStartAt = at + PULSE_STAGGER_MS
  return at - now
}

export function pulseStatus(siteId: number) {
  const c = conns.get(siteId)
  if (!c) return { active: false, connected: false, lastMessageAt: null as number | null, startedAt: null as number | null }
  return { active: true, connected: c.ws?.readyState === WebSocket.OPEN, lastMessageAt: c.lastMessageAt || null, startedAt: c.startedAt }
}

/**
 * Called every collection tick: an open connection that has been silent for PULSE_STALE_MS is dropped,
 * so the normal reconnect (with backoff) takes over. Returns true when it dropped one.
 */
export function pulseWatchdog(siteId: number, now = Date.now(), log = console): boolean {
  const c = conns.get(siteId)
  if (!c?.ws || c.ws.readyState !== WebSocket.OPEN || !c.ackAt) return false
  const silentFor = now - Math.max(c.lastMessageAt, c.ackAt)
  if (silentFor < PULSE_STALE_MS) return false
  log.warn(`[pulse] site ${siteId}: no reading for ${Math.round(silentFor / 1000)} s, reconnecting`)
  c.ws.terminate()
  return true
}

/** Average grid power over the last windowMs, or undefined if there is no recent data */
export function pulseGridW(siteId: number, windowMs = 60_000): number | undefined {
  const c = conns.get(siteId)
  if (!c) return undefined
  const since = Date.now() - windowMs
  const recent = c.buffer.filter((r) => r.ts >= since)
  if (!recent.length) return undefined
  return recent.reduce((s, r) => s + r.gridW, 0) / recent.length
}

export function stopPulse(siteId: number) {
  const c = conns.get(siteId)
  if (!c) return
  c.stopped = true
  clearTimeout(c.timer)
  c.ws?.close()
  conns.delete(siteId)
}

export function startPulse(siteId: number, creds: TibberCredentials, homeId: string, log = console, random = Math.random) {
  stopPulse(siteId)
  const conn: Conn = { buffer: [], stopped: false, retry: 0, lastMessageAt: 0, ackAt: 0, startedAt: Date.now() }
  conns.set(siteId, conn)

  const connect = async () => {
    if (conn.stopped) return
    try {
      const url = await tibberWebsocketUrl(creds)
      const ws = new WebSocket(url, 'graphql-transport-ws', { headers: { 'User-Agent': tibberUserAgent } })
      conn.ws = ws
      ws.on('open', () => ws.send(JSON.stringify({ type: 'connection_init', payload: { token: creds.token } })))
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { type: string; payload?: any }
        if (msg.type === 'connection_ack') {
          conn.ackAt = Date.now()
          ws.send(JSON.stringify({
            id: '1',
            type: 'subscribe',
            payload: { query: `subscription { liveMeasurement(homeId: "${homeId}") { timestamp power powerProduction } }` },
          }))
        } else if (msg.type === 'next') {
          const m = msg.payload?.data?.liveMeasurement
          if (!m) return
          conn.lastMessageAt = Date.now()
          conn.buffer.push({ ts: Date.now(), gridW: (m.power ?? 0) - (m.powerProduction ?? 0) })
          const cutoff = Date.now() - 5 * 60_000
          while (conn.buffer.length && conn.buffer[0]!.ts < cutoff) conn.buffer.shift()
        } else if (msg.type === 'error') {
          log.warn('[pulse] subscription error', JSON.stringify(msg.payload))
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
      })
      ws.on('close', () => schedule())
      ws.on('error', (err) => log.warn('[pulse] websocket error', err.message))
    } catch (err) {
      log.warn('[pulse] connect failed', (err as Error).message)
      schedule()
    }
  }

  const schedule = () => {
    if (conn.stopped) return
    clearTimeout(conn.timer)
    // Only a connection that stayed up and delivered readings starts the backoff over: one that Tibber drops
    // right away, or that stayed silent until the watchdog closed it, keeps backing off
    if (conn.ackAt && conn.lastMessageAt > conn.ackAt && Date.now() - conn.ackAt >= PULSE_STABLE_MS) conn.retry = 0
    conn.ackAt = 0
    conn.timer = setTimeout(connect, backoffDelay(conn.retry++, { ...PULSE_BACKOFF, random }))
  }

  conn.timer = setTimeout(connect, staggerDelay())
}
