import { packetFingerprint } from './crypto'

/**
 * The air conditioner's own messages (the M-Smart "0xAC" protocol), the same bytes the app would send over the
 * home network. Through the cloud they go inside a packet (`lanPacket`) to `/v1/appliance/transparent/send`.
 * Byte layout from midea-beautiful-air (command.py) and msmart-ng.
 */

export type AcMode = 'auto' | 'cool' | 'dry' | 'heat' | 'fan'
export const AC_MODES: readonly AcMode[] = ['auto', 'cool', 'dry', 'heat', 'fan']
const MODE_CODE: Record<AcMode, number> = { auto: 1, cool: 2, dry: 3, heat: 4, fan: 5 }

/** Fan speeds the app offers; any other 1-100 is a percentage */
export const FAN = { silent: 20, low: 40, medium: 60, high: 80, full: 100, auto: 102 } as const

export const AC_MIN_C = 16
export const AC_MAX_C = 30

/** What a status answer says */
export interface AcState {
  running: boolean
  /** null for a mode we don't know (the unit reports 0 when it is off on some models) */
  mode: AcMode | null
  targetC: number
  fanSpeed: number
  indoorC: number | null
  outdoorC: number | null
  eco: boolean
  turbo: boolean
  /** Raw swing bits: vertical 0x0C, horizontal 0x03 */
  swing: number
  purifier: boolean
  dryer: boolean
  frostProtect: boolean
  comfortMode: boolean
  comfortSleep: boolean
  /** The unit's error code, 0 when fine */
  errorCode: number
}

/** What a set command carries. The command sets everything at once, so it starts from the last status. */
export type AcControl = Pick<AcState, 'running' | 'targetC' | 'fanSpeed' | 'eco' | 'turbo' | 'swing' | 'purifier' | 'dryer' | 'frostProtect' | 'comfortMode' | 'comfortSleep'> & {
  mode: AcMode
}

const CRC8_TABLE = (() => {
  const t: number[] = []
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let b = 0; b < 8; b++) c = c & 1 ? (c >> 1) ^ 0x8c : c >> 1
    t.push(c)
  }
  return t
})()

export function crc8(data: Uint8Array): number {
  let crc = 0
  for (const b of data) crc = CRC8_TABLE[crc ^ b]!
  return crc
}

/** CRC8 over the body, then the frame checksum; the sequence number goes in byte 30 */
function finalize(frame: Uint8Array, seq: number): Uint8Array {
  frame[30] = seq & 0xff
  frame[frame.length - 2] = crc8(frame.subarray(10, frame.length - 2))
  let sum = 0
  for (let i = 1; i < frame.length - 1; i++) sum += frame[i]!
  frame[frame.length - 1] = (~sum + 1) & 0xff
  return frame
}

let sequence = 0
const nextSeq = () => (sequence = (sequence + 1) & 0xff)

/** Status query (0x41) */
export function statusFrame(seq = nextSeq()): Uint8Array {
  const f = new Uint8Array(33)
  f.set([0xaa, 0x20, 0xac, 0, 0, 0, 0, 0, 0, 0x03, 0x41, 0x81, 0x00, 0xff, 0x03, 0xff, 0x00, 0x02])
  return finalize(f, seq)
}

export function isValidTarget(c: number): boolean {
  return Number.isFinite(c) && c >= AC_MIN_C && c <= AC_MAX_C && Math.round(c * 2) === c * 2
}

/** Set command (0x40): power, mode, target, fan and the switches, all at once */
export function setFrame(s: AcControl, seq = nextSeq()): Uint8Array {
  if (!isValidTarget(s.targetC)) throw new Error(`Target ${s.targetC} °C is outside ${AC_MIN_C}-${AC_MAX_C} °C`)
  const f = new Uint8Array(36)
  f.set([0xaa, 0x23, 0xac, 0, 0, 0, 0, 0, 0, 0x02, 0x40])
  // No beep (bit 0x40): it may be in a bedroom
  f[11] = s.running ? 0x01 : 0x00
  const whole = Math.floor(s.targetC)
  f[12] = ((MODE_CODE[s.mode] & 0x07) << 5) | (s.targetC - whole === 0.5 ? 0x10 : 0) | ((whole - 16) & 0x0f)
  f[13] = s.fanSpeed & 0x7f
  // Keep the swing as it is: 0x30 plus the vertical and horizontal bits (msmart-ng)
  f[17] = 0x30 | (s.swing & 0x0f)
  f[18] = s.comfortSleep ? 0x03 : 0
  f[19] = (s.eco ? 0x80 : 0) | (s.purifier ? 0x20 : 0) | (s.dryer ? 0x04 : 0)
  f[20] = (s.comfortSleep ? 0x80 : 0) | (s.turbo ? 0x02 : 0)
  f[31] = s.frostProtect ? 0x80 : 0
  f[32] = s.comfortMode ? 0x01 : 0
  return finalize(f, seq)
}

/** The frame inside the 40-byte header and 16-byte fingerprint the cloud passes on to the unit */
export function lanPacket(applianceId: string, frame: Uint8Array, now = new Date()): Uint8Array {
  const p = new Uint8Array(40 + frame.length)
  p.set([0x5a, 0x5a, 0x01, 0x11, 0, 0, 0x20, 0x00])
  p.set([Math.floor(now.getMilliseconds() / 10), now.getSeconds(), now.getMinutes(), now.getHours(), now.getDate(), now.getMonth() + 1, now.getFullYear() % 100, Math.floor(now.getFullYear() / 100)], 12)
  let id = BigInt(applianceId)
  for (let i = 0; i < 8; i++) {
    p[20 + i] = Number(id & 0xffn)
    id >>= 8n
  }
  p.set(frame, 40)
  const len = p.length + 16
  p[4] = len & 0xff
  p[5] = (len >> 8) & 0xff
  const out = new Uint8Array(len)
  out.set(p)
  out.set(packetFingerprint(p), p.length)
  return out
}

function temperature(whole: number, tenthNibble: number): number | null {
  if (whole === 0 || whole === 0xff) return null
  const t = (whole - 50) / 2
  const d = 0.1 * tenthNibble
  return Math.round((t < 0 ? t - d : t + d) * 10) / 10
}

const MODES_BY_CODE: Record<number, AcMode> = { 1: 'auto', 2: 'cool', 3: 'dry', 4: 'heat', 5: 'fan' }

/** The body of a status answer (0xC0), after the 10-byte frame header */
export function parseStatus(d: Uint8Array): AcState {
  if (d.length < 17 || d[0] !== 0xc0) throw new Error(`Not a status answer (${d[0]?.toString(16) ?? 'empty'})`)
  return {
    running: (d[1]! & 0x01) !== 0,
    mode: MODES_BY_CODE[(d[2]! & 0xe0) >> 5] ?? null,
    targetC: (d[2]! & 0x0f) + 16 + (d[2]! & 0x10 ? 0.5 : 0),
    fanSpeed: d[3]! & 0x7f,
    swing: d[7]! & 0x0f,
    comfortSleep: (d[9]! & 0x40) !== 0,
    eco: (d[9]! & 0x10) !== 0,
    purifier: (d[9]! & 0x20) !== 0,
    dryer: (d[9]! & 0x04) !== 0,
    turbo: (d[10]! & 0x02) !== 0,
    indoorC: temperature(d[11]!, d[15]! & 0x0f),
    outdoorC: temperature(d[12]!, (d[15]! & 0xf0) >> 4),
    errorCode: d[16]!,
    frostProtect: d.length >= 22 ? (d[21]! & 0x80) !== 0 : (d[10]! & 0x20) !== 0,
    comfortMode: d.length >= 23 ? (d[22]! & 0x01) !== 0 : false,
  }
}

/**
 * The unit's answer as the cloud hands it back: the same 40-byte header, then the frame. Only a status answer
 * (message type 2-5, body 0xC0) is read; anything else is null.
 */
export function parseReply(reply: Uint8Array): AcState | null {
  const frame = reply.subarray(40)
  if (frame.length < 11 || frame[0] !== 0xaa || ![2, 3, 4, 5].includes(frame[9]!)) return null
  const body = frame.subarray(10)
  return body[0] === 0xc0 ? parseStatus(body) : null
}
