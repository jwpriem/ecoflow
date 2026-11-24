import { afterEach, describe, expect, it, vi } from 'vitest'
import { lanPacket, parseReply, parseStatus, setFrame, statusFrame, crc8, type AcControl } from '../server/providers/midea/ac'
import {
  aesDecryptHex,
  aesEncryptHex,
  bytesToCsv,
  csvToBytes,
  dataKeys,
  encryptIamPassword,
  encryptPassword,
  mideaDeviceId,
  signRequest,
} from '../server/providers/midea/crypto'
import { isMideaServer, MideaError, mideaAcSet, mideaAcStatus, mideaAppliances, mideaLogin } from '../server/providers/midea'
import { resetProviders } from '../server/providers/http'
import { aircoHistory, controlFor, parseAircoChange } from '../server/services/midea'
import { aircoSamples } from '../server/db/schema'
import { createAccount } from '../server/services/setup'
import { freshDb } from './support/pglite'

afterEach(() => {
  vi.unstubAllGlobals()
  resetProviders()
})

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'))

// Expected bytes and hashes made with midea-beautiful-air 0.10.7, the library the probe on the real unit used
describe('Midea signing and encryption', () => {
  it('hashes the password the way the SmartHome app does', () => {
    expect(encryptPassword('LOGINID123', 'Secret!pw')).toBe('89211775da60249d53ebd407decd0b3eb7610ad577d9aba4673e2ee3dca4065f')
    expect(encryptIamPassword('LOGINID123', 'Secret!pw')).toBe('9c06cb59f4900641a590262bc456b6fa5469d9366b0df2a877a48e1886fea5ec')
  })

  it('signs a request body', () => {
    expect(signRequest('{"a":1}', '1700000000')).toBe('b4ec9abc070f98cb7f549acafb8db7ec1c2c076537f153c8e311079eeed30e82')
  })

  it('takes the command key and IV out of the login answer', () => {
    const keys = dataKeys('9c3cbae92cde658a41a2f053cd8c2daff954fb0103abc6dbb2776efddfe43629', 'c34d95602a528c4968ff15e7ca105d2dbe6ccfa58d0bf985b65f045fc142e318')
    expect(keys).toEqual({ key: '0123456789abcdef', iv: 'fedcba9876543210' })
    expect(aesEncryptHex('1,2,-86', keys.key, keys.iv)).toBe('eea54aaaac0434d9b0009329fe9de90c')
    expect(aesDecryptHex('eea54aaaac0434d9b0009329fe9de90c', keys.key, keys.iv)).toBe('1,2,-86')
  })

  it('writes bytes as signed numbers and back', () => {
    expect(bytesToCsv(Uint8Array.from([0, 1, 127, 128, 255]))).toBe('0,1,127,-128,-1')
    expect(Array.from(csvToBytes('0,1,127,-128,-1'))).toEqual([0, 1, 127, 128, 255])
  })

  it('gives every account its own fixed device ID', () => {
    expect(mideaDeviceId('a@b.c')).toBe('2e6c6262dfa61bbe')
    expect(mideaDeviceId('x@y.z')).not.toBe(mideaDeviceId('a@b.c'))
  })

  it('only trusts Midea hosts from the account router', () => {
    expect(isMideaServer('https://mp-us-prod.appsmb.com/mas/v5/app/proxy?alias=')).toBe(true)
    expect(isMideaServer('https://mp-prod.smartmidea.net/mas/v5/app/proxy?alias=')).toBe(true)
    expect(isMideaServer('https://evil.example/appsmb.com?alias=')).toBe(false)
    expect(isMideaServer('https://appsmb.com.evil.example/?alias=')).toBe(false)
    expect(isMideaServer('http://mp-us-prod.appsmb.com/mas/v5/app/proxy?alias=')).toBe(false)
  })
})

describe('air conditioner messages', () => {
  it('computes the CRC8 the unit checks', () => {
    expect(crc8(Uint8Array.from({ length: 20 }, (_, i) => i))).toBe(129)
  })

  it('builds the status query', () => {
    expect(hex(statusFrame(5))).toBe('aa20ac00000000000003418100ff03ff0002000000000000000000000000051057')
  })

  const base: AcControl = { running: true, mode: 'heat', targetC: 21.5, fanSpeed: 102, eco: false, turbo: false, swing: 0, purifier: false, dryer: false, frostProtect: false, comfortMode: false, comfortSleep: false }

  it('builds a set command', () => {
    expect(hex(setFrame(base, 10))).toBe('aa23ac0000000000000240019566000000300000000000000000000000000a0000009920')
    expect(hex(setFrame({ ...base, running: false, mode: 'cool', targetC: 24, fanSpeed: 40, eco: true, purifier: true, turbo: true }, 11))).toBe(
      'aa23ac00000000000002400048280000003000a0020000000000000000000b000000adf5',
    )
  })

  it('refuses a target the unit cannot take', () => {
    expect(() => setFrame({ ...base, targetC: 31 })).toThrow()
    expect(() => setFrame({ ...base, targetC: 20.3 })).toThrow()
  })

  it('wraps a frame in the packet the cloud passes on', () => {
    const packet = lanPacket('219902325612345', statusFrame(4), new Date(2026, 10, 24, 19, 5, 7, 450))
    expect(hex(packet)).toBe(
      '5a5a011159002000000000002d070513180b1a1439df000000c80000000000000000000000000000aa20ac00000000000003418100ff03ff0002000000000000000000000000044e1aa349ce42359a48b19f5951aec03206de',
    )
  })

  it('reads a status answer', () => {
    expect(parseStatus(fromHex('c00196660000000c0010005136000025000000000000000000'))).toEqual({
      running: true,
      mode: 'heat',
      targetC: 22.5,
      fanSpeed: 102,
      swing: 0x0c,
      comfortSleep: false,
      eco: true,
      purifier: false,
      dryer: false,
      turbo: false,
      indoorC: 16,
      outdoorC: 2.2,
      errorCode: 0,
      frostProtect: false,
      comfortMode: false,
    })
  })

  it('reads only status answers out of a reply', () => {
    const frame = (type: number, body: string) => Uint8Array.from([...new Uint8Array(40), 0xaa, 0x20, 0xac, 0, 0, 0, 0, 0, 0, type, ...fromHex(body)])
    expect(parseReply(frame(3, 'c00196660000000c0010005136000025000000000000000000'))?.targetC).toBe(22.5)
    expect(parseReply(frame(3, 'b5010000000000000000000000000000000000'))).toBeNull()
    expect(parseReply(frame(9, 'c00196660000000c0010005136000025000000000000000000'))).toBeNull()
  })
})

describe('Midea cloud client', () => {
  // The login answer carries the command key and IV, encrypted with the app key (as dataKeys reads them)
  const token = '9c3cbae92cde658a41a2f053cd8c2daff954fb0103abc6dbb2776efddfe43629'
  const random = 'c34d95602a528c4968ff15e7ca105d2dbe6ccfa58d0bf985b65f045fc142e318'
  const keys = { key: '0123456789abcdef', iv: 'fedcba9876543210' }

  const statusBody = 'c00196660000000c0010005136000025000000000000000000'
  const reply = () => aesEncryptHex(bytesToCsv(Uint8Array.from([...new Uint8Array(40), 0xaa, 0x20, 0xac, 0, 0, 0, 0, 0, 0, 3, ...fromHex(statusBody)])), keys.key, keys.iv)

  function stubCloud(over: Record<string, (body: any) => unknown> = {}) {
    const calls: { url: string; body: any; headers: Record<string, string> }[] = []
    const answers: Record<string, (body: any) => unknown> = {
      '/v1/unitcenter/router/user/name': () => ({ masUrl: 'https://mp-us-prod.appsmb.com/mas/v5/app/proxy?alias=' }),
      '/v1/user/login/id/get': () => ({ loginId: 'LID' }),
      '/mj/user/login': () => ({ uid: 'U1', accessToken: token, randomData: random, mdata: { accessToken: 'HDR' } }),
      '/v1/appliance/user/list/get': () => ({ list: [{ id: '219902325612345', name: 'Slaapkamer airco', type: '0xAC', onlineStatus: '1' }, { id: '7', name: 'Ontvochtiger', type: '0xA1' }] }),
      '/v1/appliance/transparent/send': () => ({ reply: reply() }),
      ...over,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body))
        calls.push({ url, body, headers: init.headers as Record<string, string> })
        const endpoint = url.split('alias=')[1]!
        const fn = answers[endpoint]
        if (!fn) return new Response('{}', { status: 404 })
        const data = fn(body)
        return Response.json(data instanceof MideaError ? { code: String(data.code), msg: data.message } : { code: '0', msg: 'ok', data })
      }),
    )
    return calls
  }

  it('logs in on the server the account router names', async () => {
    const calls = stubCloud()
    const s = await mideaLogin({ email: ' Jeroen@Example.com ', password: 'pw' })
    expect(s).toMatchObject({ server: 'https://mp-us-prod.appsmb.com/mas/v5/app/proxy?alias=', uid: 'U1', accessToken: 'HDR', ...keys, deviceId: mideaDeviceId('jeroen@example.com') })
    expect(calls.map((c) => c.url.replace(/\?alias=.*/, ''))).toEqual([
      'https://mp-prod.appsmb.com/mas/v5/app/proxy',
      'https://mp-us-prod.appsmb.com/mas/v5/app/proxy',
      'https://mp-us-prod.appsmb.com/mas/v5/app/proxy',
    ])
    // The old region lookup is never asked: it doesn't know accounts on another server
    expect(calls.some((c) => c.url.includes('multicloud'))).toBe(false)
    const login = calls[2]!.body
    expect(login.iotData.loginAccount).toBe('jeroen@example.com')
    expect(login.iotData.password).toBe(encryptPassword('LID', 'pw'))
    // Every request is signed over its exact body
    for (const c of calls) expect(c.headers.sign).toBe(signRequest(JSON.stringify(c.body), c.headers.random!))
  })

  it('stays on the default server when the router has no answer', async () => {
    stubCloud({ '/v1/unitcenter/router/user/name': () => null })
    expect((await mideaLogin({ email: 'a@b.c', password: 'pw' })).server).toBe('https://mp-prod.appsmb.com/mas/v5/app/proxy?alias=')
  })

  it('ignores a router answer that points away from Midea', async () => {
    stubCloud({ '/v1/unitcenter/router/user/name': () => ({ masUrl: 'https://evil.example/?alias=' }) })
    expect((await mideaLogin({ email: 'a@b.c', password: 'pw' })).server).toBe('https://mp-prod.appsmb.com/mas/v5/app/proxy?alias=')
  })

  it('names the device limit and a wrong password', async () => {
    stubCloud({ '/mj/user/login': () => new MideaError('该用户在线登录设备已超过上限', 65027, 'other') })
    await expect(mideaLogin({ email: 'a@b.c', password: 'pw' })).rejects.toMatchObject({ kind: 'limit', code: 65027 })
    stubCloud({ '/v1/user/login/id/get': () => new MideaError('Account or password incorrect', 3102, 'other') })
    await expect(mideaLogin({ email: 'a@b.c', password: 'pw' })).rejects.toMatchObject({ kind: 'auth' })
  })

  it('lists the appliances and reads the air conditioner', async () => {
    const calls = stubCloud()
    const s = await mideaLogin({ email: 'a@b.c', password: 'pw' })
    const list = await mideaAppliances(s)
    expect(list).toEqual([
      { id: '219902325612345', name: 'Slaapkamer airco', type: '0xAC', online: true },
      { id: '7', name: 'Ontvochtiger', type: '0xA1', online: true },
    ])
    const state = await mideaAcStatus(s, '219902325612345')
    expect(state).toMatchObject({ running: true, mode: 'heat', targetC: 22.5, indoorC: 16, outdoorC: 2.2 })
    const send = calls.find((c) => c.url.endsWith('/v1/appliance/transparent/send'))!
    // The gateway refuses fields it doesn't know (applianceId, appVNum): only its own list goes out
    const allowed = ['stamp', 'src', 'clientType', 'userId', 'order', 'uid', 'deviceId', 'utcTimestamp', 'timestamp', 'format', 'language', 'reqId', 'applianceCode', 'homegroupId', 'appId', 'waitResp', 'isFull', 'funId']
    expect(Object.keys(send.body).every((k) => allowed.includes(k))).toBe(true)
    expect(send.body.applianceCode).toBe('219902325612345')
    expect(send.headers).toMatchObject({ uid: 'U1', accessToken: 'HDR' })
    // The order is the encrypted packet with the status query in it
    const packet = csvToBytes(aesDecryptHex(send.body.order, keys.key, keys.iv))
    expect(packet.subarray(40, 51)).toEqual(Uint8Array.from([0xaa, 0x20, 0xac, 0, 0, 0, 0, 0, 0, 0x03, 0x41]))
  })

  it('sends a set command and reads the answer', async () => {
    const calls = stubCloud()
    const s = await mideaLogin({ email: 'a@b.c', password: 'pw' })
    const state = await mideaAcSet(s, '219902325612345', controlFor(parseStatus(fromHex(statusBody)), { targetC: 21 }))
    expect(state.targetC).toBe(22.5)
    const packet = csvToBytes(aesDecryptHex(calls.at(-1)!.body.order, keys.key, keys.iv))
    const frame = packet.subarray(40, packet.length - 16)
    expect(frame[10]).toBe(0x40)
    // Heat (4), 21 °C, eco kept from the status
    expect(frame[12]).toBe((4 << 5) | 5)
    expect(frame[19]! & 0x80).toBe(0x80)
    expect(frame[17]).toBe(0x30 | 0x0c)
  })
})

describe('air conditioner changes', () => {
  it('accepts what the app may change', () => {
    expect(parseAircoChange({ running: true, mode: 'cool', targetC: 21.5, fanSpeed: 102 })).toEqual({ running: true, mode: 'cool', targetC: 21.5, fanSpeed: 102 })
  })

  it('refuses anything else', () => {
    for (const body of [{}, { mode: 'turbo' }, { targetC: 15 }, { targetC: 21.3 }, { targetC: '21' }, { fanSpeed: 101 }, { fanSpeed: 0 }, { running: 'yes' }]) {
      expect(() => parseAircoChange(body)).toThrow()
    }
  })

  it('keeps the rest of the settings when one thing changes', () => {
    const st = parseStatus(fromHex('c00196660000000c0010005136000025000000000000000000'))
    expect(controlFor(st, { running: false })).toMatchObject({ running: false, mode: 'heat', targetC: 22.5, fanSpeed: 102, eco: true, swing: 0x0c })
  })
})

describe('aircoHistory', () => {
  it('gives the readings of the asked hours per air conditioner, oldest first', async () => {
    const db = await freshDb()
    const { site } = await createAccount(db, 'airco@example.com', 'a-long-password')
    const other = await createAccount(db, 'other@example.com', 'a-long-password')
    const now = new Date('2026-11-24T19:00:00Z')
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000)
    await db.insert(aircoSamples).values([
      { siteId: site.id, applianceId: 'A', ts: ago(1), running: true, mode: 'heat', targetC: 22, indoorC: 16, outdoorC: 2 },
      { siteId: site.id, applianceId: 'A', ts: ago(2), running: false, mode: 'heat', targetC: 22, indoorC: 15, outdoorC: 2.5 },
      { siteId: site.id, applianceId: 'A', ts: ago(30), running: false, indoorC: 14 },
      { siteId: site.id, applianceId: 'B', ts: ago(3), running: false, indoorC: 19 },
      { siteId: other.site.id, applianceId: 'A', ts: ago(1), running: true, indoorC: 25 },
    ])
    const h = await aircoHistory(db, site.id, 24, now)
    expect(Object.keys(h).sort()).toEqual(['A', 'B'])
    expect(h.A!.map((p) => p.indoorC)).toEqual([15, 16])
    expect(h.A![1]).toEqual({ ts: ago(1).toISOString(), running: true, targetC: 22, indoorC: 16, outdoorC: 2 })
    expect((await aircoHistory(db, site.id, 48, now)).A).toHaveLength(3)
  })
})
