import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetProviders } from '../server/providers/http'
import { parseReading, scales, stringToSign, TuyaError, tuyaReadSensor, tuyaSign, tuyaToken } from '../server/providers/tuya'

afterEach(() => {
  vi.unstubAllGlobals()
  resetProviders()
})

const creds = { accessId: 'id123', accessSecret: 'secret456', deviceId: 'bf0123abc' }
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('Tuya signing', () => {
  it('signs method, body hash, empty headers and the path with a sorted query', () => {
    expect(stringToSign('get', '/v1.0/token?grant_type=1')).toBe(`GET\n${EMPTY_SHA}\n\n/v1.0/token?grant_type=1`)
    expect(stringToSign('GET', '/v1.0/x?b=2&a=1')).toBe(`GET\n${EMPTY_SHA}\n\n/v1.0/x?a=1&b=2`)
  })

  it('puts the token between client id and time, uppercase hex', () => {
    const base = { accessId: 'id', secret: 's', t: '1700000000000', nonce: 'n', method: 'GET', path: '/v1.0/devices/d' }
    const expected = createHmac('sha256', 's').update(`idtok1700000000000n${stringToSign('GET', '/v1.0/devices/d')}`).digest('hex').toUpperCase()
    expect(tuyaSign({ ...base, accessToken: 'tok' })).toBe(expected)
    expect(tuyaSign(base)).not.toBe(expected)
  })
})

describe('Tuya sensor reading', () => {
  const device = {
    name: 'Woonkamer',
    online: true,
    status: [
      { code: 'va_temperature', value: 214 },
      { code: 'va_humidity', value: 48 },
      { code: 'battery_percentage', value: 90 },
    ],
  }

  it('scales with the specification', () => {
    const spec = { status: [{ code: 'va_temperature', values: '{"unit":"℃","min":-200,"max":600,"scale":1,"step":1}' }, { code: 'va_humidity', values: '{"scale":0}' }] }
    expect(scales(spec)).toEqual({ va_temperature: 1, va_humidity: 0 })
    expect(parseReading(device, spec)).toEqual({ name: 'Woonkamer', online: true, tempC: 21.4, humidity: 48, battery: 90 })
  })

  it('guesses tenths without a specification', () => {
    expect(parseReading(device, null).tempC).toBe(21.4)
    expect(parseReading({ status: [{ code: 'temp_current', value: 21 }, { code: 'humidity_value', value: 455 }] }, null)).toMatchObject({ tempC: 21, humidity: 45.5 })
  })

  it('has no temperature for a device without one', () => {
    expect(parseReading({ name: 'Plug', status: [{ code: 'switch_1', value: true }] }, null).tempC).toBeNull()
  })

  it('gets a token and reads the device through the API', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers })
      const path = new URL(url).pathname
      const result = path === '/v1.0/token' ? { access_token: 'tok', expire_time: 7200 } : path.endsWith('/specifications') ? { status: [] } : device
      return new Response(JSON.stringify({ success: true, result }))
    })
    const token = await tuyaToken(creds, () => 1_000)
    expect(token).toEqual({ accessToken: 'tok', expiresAt: 1_000 + 7_200_000 })
    expect(calls[0]!.headers.access_token).toBeUndefined()
    const r = await tuyaReadSensor(creds, token)
    expect(r.tempC).toBe(21.4)
    expect(calls[1]!.url).toBe('https://openapi.tuyaeu.com/v1.0/devices/bf0123abc')
    expect(calls[1]!.headers).toMatchObject({ client_id: 'id123', access_token: 'tok', sign_method: 'HMAC-SHA256' })
  })

  it('names a refused sign-in', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, code: 1004, msg: 'sign invalid' })))
    const err = await tuyaToken(creds).catch((e) => e)
    expect(err).toBeInstanceOf(TuyaError)
    expect(err.kind).toBe('auth')
    expect(err.message).toBe('Tuya: sign invalid (1004)')
  })
})
