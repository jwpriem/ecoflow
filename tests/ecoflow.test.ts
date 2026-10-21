import { describe, expect, it, vi } from 'vitest'
import {
  deviceQuota,
  ecoflowRequest,
  flattenParams,
  listDevices,
  parseStreamQuota,
  sign,
  signString,
  streamDevices,
} from '../server/providers/ecoflow'

const creds = { accessKey: 'Fp4SvIprYSDPXtYJidEtUAd1o', secretKey: 'WIbFEKre0s6sLnh4ei7SPUeYnptHG6V' }
const fixed = { now: () => 1671171709428, nonce: () => '345164' }

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('EcoFlow signing', () => {
  it('matches the example from the EcoFlow developer docs', () => {
    const params = { sn: '123456789', params: { cmdSet: 11, id: 24, eps: 0 } }
    const str = signString(params, creds.accessKey, '345164', '1671171709428')
    expect(str).toBe('params.cmdSet=11&params.eps=0&params.id=24&sn=123456789&accessKey=Fp4SvIprYSDPXtYJidEtUAd1o&nonce=345164&timestamp=1671171709428')
    expect(sign(creds.secretKey, str)).toBe('07c13b65e037faf3b153d51613638fa80003c4c38d2407379a7f52851af1473e')
  })

  it('signs only the auth part when there are no parameters', () => {
    expect(signString({}, 'ak', '1', '2')).toBe('accessKey=ak&nonce=1&timestamp=2')
  })

  it('flattens arrays with an index', () => {
    expect(flattenParams({ sn: 'X', params: { quotas: ['cmsBattSoc', 'powGetBpCms'] } })).toEqual([
      ['sn', 'X'],
      ['params.quotas[0]', 'cmsBattSoc'],
      ['params.quotas[1]', 'powGetBpCms'],
    ])
  })
})

describe('EcoFlow requests', () => {
  it('sends GET parameters as query string with the signed headers', async () => {
    const f = fakeFetch({ code: '0', message: 'Success', data: { cmsBattSoc: 55 } })
    const data = await deviceQuota(creds, 'BK11ZEB4', { ...fixed, fetch: f })
    expect(data).toEqual({ cmsBattSoc: 55 })
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://api-e.ecoflow.com/iot-open/sign/device/quota/all?sn=BK11ZEB4')
    const h = init!.headers as Record<string, string>
    expect(h.accessKey).toBe(creds.accessKey)
    expect(h.nonce).toBe('345164')
    expect(h.timestamp).toBe('1671171709428')
    expect(h.sign).toBe(sign(creds.secretKey, `sn=BK11ZEB4&accessKey=${creds.accessKey}&nonce=345164&timestamp=1671171709428`))
    expect(init!.body).toBeUndefined()
  })

  it('sends a JSON body for POST and uses the configured host', async () => {
    const f = fakeFetch({ code: 0, data: { cmsBattSoc: 1 } })
    await ecoflowRequest(creds, 'POST', '/iot-open/sign/device/quota', { sn: 'A', params: { quotas: ['cmsBattSoc'] } }, { ...fixed, fetch: f, host: 'https://api-a.ecoflow.com' })
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://api-a.ecoflow.com/iot-open/sign/device/quota')
    expect(JSON.parse(init!.body as string)).toEqual({ sn: 'A', params: { quotas: ['cmsBattSoc'] } })
    expect((init!.headers as Record<string, string>)['Content-Type']).toMatch(/application\/json/)
  })

  it('throws the API message on a non-zero code', async () => {
    const f = fakeFetch({ code: '8521', message: 'signature is wrong' })
    await expect(listDevices(creds, { fetch: f })).rejects.toThrow('EcoFlow: signature is wrong (code 8521)')
  })

  it('throws on an HTTP error', async () => {
    await expect(listDevices(creds, { fetch: fakeFetch({}, 502) })).rejects.toThrow('EcoFlow HTTP 502')
  })

  it('returns the device list', async () => {
    const list = [{ sn: 'BK1', deviceName: 'STREAM Pro 1', productName: 'STREAM Pro', online: 1 }]
    expect(await listDevices(creds, { fetch: fakeFetch({ code: '0', data: list }) })).toEqual(list)
    expect(await listDevices(creds, { fetch: fakeFetch({ code: '0' }) })).toEqual([])
  })
})

describe('STREAM quota mapping', () => {
  it('reads SoC, PV and battery power (+ = charging)', () => {
    expect(parseStreamQuota({ cmsBattSoc: 64.0, powGetBpCms: 350.4, powGetPvSum: 120 })).toEqual({ soc: 0.64, powerW: -350, pvW: 120 })
    expect(parseStreamQuota({ cmsBattSoc: 64, powGetBpCms: -800 })).toEqual({ soc: 0.64, powerW: 800, pvW: 0 })
  })

  it('lets the charge/discharge state decide the direction', () => {
    expect(parseStreamQuota({ powGetBpCms: 500, cmsChgDsgState: 2 }).powerW).toBe(500)
    expect(parseStreamQuota({ powGetBpCms: -500, cmsChgDsgState: 1 }).powerW).toBe(-500)
  })

  it('sums the PV inputs without a total, accepts numeric strings and leaves a missing SoC empty', () => {
    expect(parseStreamQuota({ powGetPv: '259.8', powGetPv2: 258.7 })).toEqual({ soc: null, powerW: 0, pvW: 519 })
  })

  it('keeps only STREAM units when the account has other devices too', () => {
    const list = [
      { sn: 'R1', productName: 'RIVER 2', online: 1 },
      { sn: 'S1', productName: 'STREAM Pro', online: 1 },
    ]
    expect(streamDevices(list).map((d) => d.sn)).toEqual(['S1'])
    expect(streamDevices([list[0]!]).map((d) => d.sn)).toEqual(['R1'])
  })
})
