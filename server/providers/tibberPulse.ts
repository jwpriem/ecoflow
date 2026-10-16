import WebSocket from 'ws'
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
}

const conns = new Map<number, Conn>()

export function pulseStatus(siteId: number) {
  const c = conns.get(siteId)
  if (!c) return { connected: false, lastMessageAt: null as number | null }
  return { connected: c.ws?.readyState === WebSocket.OPEN, lastMessageAt: c.lastMessageAt || null }
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

export function startPulse(siteId: number, creds: TibberCredentials, homeId: string, log = console) {
  stopPulse(siteId)
  const conn: Conn = { buffer: [], stopped: false, retry: 0, lastMessageAt: 0 }
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
          conn.retry = 0
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
    const delay = Math.min(300_000, 5_000 * 2 ** conn.retry++)
    conn.timer = setTimeout(connect, delay)
  }

  void connect()
}
