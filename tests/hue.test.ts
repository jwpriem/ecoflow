import { afterEach, describe, expect, it, vi } from 'vitest'
import { glow, hexToRgb, lampRgb, lightsSummary, mirekToRgb, mixRgb, rgbToHex, rgbToXy, xyToRgb } from '../app/utils/hue'
import { hueCommand, hueState, type HueRaw } from '../server/lib/hue'
import { hueAuthorizeUrl, hueCreateAppKey, hueExchangeCode, hueTokenNeedsRefresh } from '../server/providers/hue'
import { resetProviders } from '../server/providers/http'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A bridge with a living room (two lamps via their devices), a bookcase zone (both lamps) and one lamp in no room */
function bridge(): HueRaw {
  const light = (n: number, extra: object = {}) => ({ id: id(n), type: 'light', owner: { rid: id(100 + n), rtype: 'device' }, metadata: { name: `Spot ${n}` }, ...extra })
  return {
    lights: [
      light(1, { on: { on: true }, dimming: { brightness: 80 }, color_temperature: { mirek: 370, mirek_valid: true, mirek_schema: { mirek_minimum: 153, mirek_maximum: 454 } } }),
      light(2, { on: { on: false }, dimming: { brightness: 40 }, color: { xy: { x: 0.6, y: 0.3 } }, color_temperature: { mirek: null, mirek_valid: false } }),
      light(3, { on: { on: true }, dimming: { brightness: 20 } }),
    ],
    devices: [1, 2, 3].map((n) => ({ id: id(100 + n), type: 'device', metadata: { name: `Device ${n}` }, services: [{ rid: id(n), rtype: 'light' }] })),
    rooms: [{ id: id(200), type: 'room', metadata: { name: 'Woonkamer', archetype: 'living_room' }, children: [{ rid: id(101), rtype: 'device' }, { rid: id(102), rtype: 'device' }], services: [{ rid: id(300), rtype: 'grouped_light' }] }],
    zones: [{ id: id(201), type: 'zone', metadata: { name: 'Vakkenkast' }, children: [{ rid: id(1), rtype: 'light' }, { rid: id(2), rtype: 'light' }], services: [{ rid: id(301), rtype: 'grouped_light' }] }],
    groupedLights: [
      { id: id(300), type: 'grouped_light', on: { on: true }, dimming: { brightness: 80 } },
      { id: id(301), type: 'grouped_light', on: { on: true } },
    ],
    connectivity: [{ id: id(400), type: 'zigbee_connectivity', owner: { rid: id(103), rtype: 'device' }, status: 'connectivity_issue' }],
  }
}

describe('hueState', () => {
  const s = hueState(bridge())

  it('reads each lamp: on, brightness, white or colour, what it can do', () => {
    const [a, b, c] = s.lights
    expect(a).toMatchObject({ id: id(1), name: 'Spot 1', on: true, brightness: 80, mirek: 370, xy: null, mirekMax: 454, supports: { dim: true, temperature: true, color: false } })
    // In colour mode the bridge marks the colour temperature invalid
    expect(b).toMatchObject({ on: false, mirek: null, xy: { x: 0.6, y: 0.3 }, supports: { color: true, temperature: true } })
    expect(c).toMatchObject({ supports: { dim: true, temperature: false, color: false }, reachable: false })
    expect(a!.reachable).toBe(true)
  })

  it('finds a room’s lamps through its devices and a zone’s directly', () => {
    const room = s.groups.find((g) => g.kind === 'room')!
    const zone = s.groups.find((g) => g.kind === 'zone')!
    expect(room).toMatchObject({ name: 'Woonkamer', groupedLightId: id(300), lightIds: [id(1), id(2)], on: true, brightness: 80 })
    expect(zone).toMatchObject({ name: 'Vakkenkast', groupedLightId: id(301), lightIds: [id(1), id(2)] })
    // No dimming on the grouped_light: the average of the lamps that are on
    expect(zone.brightness).toBe(80)
  })

  it('lists rooms before zones', () => {
    expect(s.groups.map((g) => g.kind)).toEqual(['room', 'zone'])
  })
})

describe('hueCommand', () => {
  it('switches on when brightness goes up and off at 0', () => {
    expect(hueCommand({ brightness: 55 })).toEqual({ on: { on: true }, dimming: { brightness: 55 } })
    expect(hueCommand({ brightness: 0 })).toEqual({ on: { on: false } })
  })

  it('keeps values in range', () => {
    expect(hueCommand({ brightness: 140 })).toMatchObject({ dimming: { brightness: 100 } })
    expect(hueCommand({ mirek: 50 })).toEqual({ color_temperature: { mirek: 153 } })
    expect(hueCommand({ xy: { x: 1.4, y: -1 } })).toEqual({ color: { xy: { x: 1, y: 0 } } })
  })

  it('prefers a white tone over a colour and refuses nothing or nonsense', () => {
    expect(hueCommand({ mirek: 300, xy: { x: 0.2, y: 0.2 } })).toEqual({ color_temperature: { mirek: 300 } })
    expect(() => hueCommand({})).toThrow()
    expect(() => hueCommand({ brightness: 'a' as unknown as number })).toThrow()
  })
})

describe('colour maths', () => {
  it('round-trips a colour through xy', () => {
    for (const c of [[255, 0, 0], [0, 255, 0], [40, 120, 255], [255, 140, 26]] as const) {
      const back = xyToRgb(rgbToXy([...c]))
      // xyToRgb gives full brightness, so compare the hue: the order of the channels
      const order = (v: readonly number[]) => [0, 1, 2].sort((i, j) => v[j]! - v[i]!)[0]
      expect(order(back)).toBe(order(c))
    }
    expect(rgbToXy([255, 255, 255]).x).toBeCloseTo(0.3127, 2)
  })

  it('makes warm whites orange and cool whites blue', () => {
    const warm = mirekToRgb(454)
    const cool = mirekToRgb(153)
    expect(warm[0]).toBe(255)
    expect(warm[2]).toBeLessThan(150)
    expect(cool[2]).toBeGreaterThan(warm[2])
  })

  it('shows a lamp only when it is on and mixes a group', () => {
    expect(lampRgb({ on: false, mirek: 300, xy: null })).toBeNull()
    expect(lampRgb({ on: true, mirek: null, xy: null })).toEqual(mirekToRgb(370))
    expect(mixRgb([[0, 0, 0], [100, 200, 50]])).toEqual([50, 100, 25])
    expect(mixRgb([])).toBeNull()
    expect(glow(null, 50).boxShadow).toBe('none')
  })

  it('reads and writes hex', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0])
    expect(hexToRgb('nope')).toBeNull()
    expect(rgbToHex([255, 128, 0])).toBe('#ff8000')
  })
})

describe('Hue Remote API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetProviders()
  })

  it('builds the sign-in URL', () => {
    const u = new URL(hueAuthorizeUrl('client', 'st.ate'))
    expect(u.origin + u.pathname).toBe('https://api.meethue.com/v2/oauth2/authorize')
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'client', response_type: 'code', state: 'st.ate' })
  })

  it('swaps the code for tokens with basic auth', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 604800 }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const t = await hueExchangeCode({ clientId: 'id', clientSecret: 'secret' }, 'CODE')
    expect(t).toMatchObject({ accessToken: 'A', refreshToken: 'R' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.meethue.com/v2/oauth2/token')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`)
    expect(String(init.body)).toBe('grant_type=authorization_code&code=CODE')
  })

  it('reports a refused sign-in as an auth error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    await expect(hueExchangeCode({ clientId: 'id', clientSecret: 's' }, 'X')).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('invalid_grant') })
  })

  it('presses the link button remotely and gets the bridge key', async () => {
    const fetch = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith('/config') ? [{ success: { '/config/linkbutton': true } }] : [{ success: { username: 'KEY' } }]), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetch)
    expect(await hueCreateAppKey('A')).toBe('KEY')
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['https://api.meethue.com/route/api/0/config', 'https://api.meethue.com/route/api'])
  })

  it('refreshes a day before the token runs out', () => {
    const now = Date.now()
    expect(hueTokenNeedsRefresh(undefined, now)).toBe(true)
    expect(hueTokenNeedsRefresh(now + 3 * 86_400_000, now)).toBe(false)
    expect(hueTokenNeedsRefresh(now + 3_600_000, now)).toBe(true)
  })
})

describe('the whole house', () => {
  it('finds the grouped light of the bridge itself, to switch everything at once', () => {
    const raw = bridge()
    expect(hueState(raw).allId).toBeNull()
    raw.groupedLights.push({ id: id(399), type: 'grouped_light', owner: { rid: id(1), rtype: 'bridge_home' }, on: { on: true } })
    expect(hueState(raw).allId).toBe(id(399))
  })
})

describe('lightsSummary', () => {
  const s = hueState(bridge())

  it('counts the lamps that are on and names their rooms, not your own groups', () => {
    const sum = lightsSummary(s)
    expect(sum.on).toBe(2)
    expect(sum.total).toBe(3)
    // Spot 1 is on in the living room; Spot 3 is on but in no room
    expect(sum.rooms).toEqual(['Woonkamer'])
    expect(sum.brightness).toBe(50)
    expect(sum.rgb).not.toBeNull()
  })

  it('is quiet when everything is off', () => {
    const off = { ...s, lights: s.lights.map((l) => ({ ...l, on: false })) }
    expect(lightsSummary(off)).toMatchObject({ on: 0, rooms: [], rgb: null, brightness: 0 })
  })
})
