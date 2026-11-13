import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkOffer, isDeviceId, nestCameras, NestEventGate, parseNestEvent, withNewline } from '../server/lib/nest'
import { nestEventMessage } from '../server/lib/notifications'
import { resetProviders } from '../server/providers/http'
import { nestAuthorizeUrl, nestCommand, nestExchangeCode, nestRefresh, nestTokenNeedsRefresh, type SdmDevice } from '../server/providers/nest'

const P = 'enterprises/proj-1/devices'
const stream = (protocols: string[], w = 640, h = 480) => ({
  'sdm.devices.traits.CameraLiveStream': { maxVideoResolution: { width: w, height: h }, videoCodecs: ['H264'], audioCodecs: ['OPUS'], supportedProtocols: protocols },
})

/** Jeroen's two cameras as SDM lists them, plus an old RTSP cam, a battery cam and a thermostat */
const devices: SdmDevice[] = [
  { name: `${P}/CAM_garden_123`, type: 'sdm.devices.types.CAMERA', traits: { 'sdm.devices.traits.Info': { customName: '' }, ...stream(['WEB_RTC'], 1920, 1080) }, parentRelations: [{ parent: 'x', displayName: 'Tuin' }] },
  { name: `${P}/DOORBELL_abc_456`, type: 'sdm.devices.types.DOORBELL', traits: { 'sdm.devices.traits.Info': { customName: 'Voordeur' }, ...stream(['WEB_RTC']) }, parentRelations: [{ parent: 'x', displayName: 'Hal' }] },
  { name: `${P}/OLD_rtsp_789`, type: 'sdm.devices.types.CAMERA', traits: { 'sdm.devices.traits.Info': { customName: 'Oprit' }, ...stream(['RTSP']) } },
  { name: `${P}/BATT_cam_000`, type: 'sdm.devices.types.CAMERA', traits: { 'sdm.devices.traits.Info': { customName: 'Schuur' }, 'sdm.devices.traits.Battery': {}, ...stream(['WEB_RTC']) } },
  { name: `${P}/THERMO_111`, type: 'sdm.devices.types.THERMOSTAT', traits: {} },
]

describe('nestCameras', () => {
  const cams = nestCameras(devices)

  it('keeps only cameras, the doorbell first, then by name', () => {
    expect(cams.map((c) => c.id)).toEqual(['DOORBELL_abc_456', 'OLD_rtsp_789', 'BATT_cam_000', 'CAM_garden_123'])
  })

  it('names a camera after itself, else its room', () => {
    expect(cams[0]).toMatchObject({ name: 'Voordeur', room: 'Hal', kind: 'doorbell', live: true, resolution: { width: 640, height: 480 }, extendable: true })
    expect(cams.find((c) => c.id === 'CAM_garden_123')).toMatchObject({ name: 'Tuin', room: 'Tuin', resolution: { width: 1920, height: 1080 } })
  })

  it('marks RTSP-only cameras as not live and battery ones as not extendable', () => {
    expect(cams.find((c) => c.id === 'OLD_rtsp_789')!.live).toBe(false)
    expect(cams.find((c) => c.id === 'BATT_cam_000')!.extendable).toBe(false)
  })
})

describe('offers', () => {
  const offer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'

  it('accepts audio, video, data in that order', () => {
    expect(checkOffer(offer)).toBeNull()
  })

  it('refuses other orders and junk', () => {
    expect(checkOffer(offer.replace('m=audio', 'm=xaudio'))).toMatch(/order/)
    expect(checkOffer('hello')).toBe('Invalid offer')
    expect(checkOffer(undefined as unknown as string)).toBe('Invalid offer')
  })

  it('ends the offer on a newline', () => {
    expect(withNewline('v=0')).toBe('v=0\r\n')
    expect(withNewline('v=0\n')).toBe('v=0\n')
  })

  it('only lets device IDs through that look like one', () => {
    expect(isDeviceId('AVPHwEtyzgSxu6EuaIOfvz')).toBe(true)
    expect(isDeviceId('../../x')).toBe(false)
    expect(isDeviceId('a b')).toBe(false)
  })
})

describe('SDM calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetProviders()
  })

  it('builds the Partner Connections sign-in URL', () => {
    const u = new URL(nestAuthorizeUrl({ projectId: 'proj-1', clientId: 'cid' }, 'https://www.wattswise.eu/api/integrations/nest/callback', 'st.ate'))
    expect(u.origin + u.pathname).toBe('https://nestservices.google.com/partnerconnections/proj-1/auth')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      redirect_uri: 'https://www.wattswise.eu/api/integrations/nest/callback',
      access_type: 'offline',
      prompt: 'consent',
      client_id: 'cid',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/sdm.service',
      state: 'st.ate',
    })
  })

  it('swaps the code for tokens with the same redirect URI', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 3599 }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const t = await nestExchangeCode({ projectId: 'p', clientId: 'id', clientSecret: 's' }, 'CODE', 'https://x/cb')
    expect(t).toMatchObject({ accessToken: 'A', refreshToken: 'R' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://www.googleapis.com/oauth2/v4/token')
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ client_id: 'id', client_secret: 's', grant_type: 'authorization_code', code: 'CODE', redirect_uri: 'https://x/cb' })
  })

  it('keeps the refresh token when a refresh brings none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'B', expires_in: 3599 }), { status: 200 })))
    const t = await nestRefresh({ projectId: 'p', clientId: 'id', clientSecret: 's', refreshToken: 'OLD' })
    expect(t).toMatchObject({ accessToken: 'B', refreshToken: 'OLD' })
  })

  it('reports an expired refresh token as an auth error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 })))
    await expect(nestRefresh({ projectId: 'p', clientId: 'id', clientSecret: 's', refreshToken: 'R' })).rejects.toMatchObject({ kind: 'auth' })
  })

  it('refreshes five minutes before the hour is up', () => {
    const now = 1_000_000
    expect(nestTokenNeedsRefresh(undefined, now)).toBe(true)
    expect(nestTokenNeedsRefresh(now + 4 * 60_000, now)).toBe(true)
    expect(nestTokenNeedsRefresh(now + 30 * 60_000, now)).toBe(false)
  })

  it('sends a live stream command and reads its results', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: { answerSdp: 'v=0', mediaSessionId: 'M', expiresAt: '2026-11-13T08:05:00Z' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const r = await nestCommand('T', 'proj-1', 'DOORBELL_abc_456', 'CameraLiveStream.GenerateWebRtcStream', { offerSdp: 'v=0\r\n' })
    expect(r).toMatchObject({ answerSdp: 'v=0', mediaSessionId: 'M' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://smartdevicemanagement.googleapis.com/v1/enterprises/proj-1/devices/DOORBELL_abc_456:executeCommand')
    expect(JSON.parse(String(init.body))).toEqual({ command: 'sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream', params: { offerSdp: 'v=0\r\n' } })
  })

  it('tells an offline camera apart from other failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'The camera is not available.' } }), { status: 400 })))
    await expect(nestCommand('T', 'p', 'DEVICE_1234', 'CameraLiveStream.GenerateWebRtcStream', {})).rejects.toMatchObject({ kind: 'offline' })
  })
})

describe('Nest events', () => {
  const push = (event: object) => ({ message: { data: Buffer.from(JSON.stringify(event)).toString('base64'), messageId: '1' }, subscription: 'projects/x/subscriptions/y' })
  const at = '2026-11-13T08:00:00.000Z'
  const now = Date.parse(at) + 2_000
  const update = (events: object, extra: object = {}) => push({ eventId: 'e', timestamp: at, resourceUpdate: { name: `${P}/DOORBELL_abc_456`, events }, eventThreadState: 'STARTED', ...extra })
  const chime = { 'sdm.devices.events.DoorbellChime.Chime': { eventSessionId: 'S1', eventId: 'a' } }
  const motion = (s = 'S2') => ({ 'sdm.devices.events.CameraMotion.Motion': { eventSessionId: s, eventId: 'b' } })
  const person = (s = 'S2') => ({ 'sdm.devices.events.CameraPerson.Person': { eventSessionId: s, eventId: 'c' } })

  it('reads the device, kinds and session from a Pub/Sub push', () => {
    expect(parseNestEvent(update(chime))).toEqual({ deviceId: 'DOORBELL_abc_456', kinds: ['chime'], sessionId: 'S1', at: new Date(at) })
  })

  it('ignores trait updates, clip previews and junk', () => {
    expect(parseNestEvent(push({ resourceUpdate: { name: `${P}/X1234567`, traits: { 'sdm.devices.traits.Info': {} } } }))).toBeNull()
    expect(parseNestEvent(update({ 'sdm.devices.events.CameraClipPreview.ClipPreview': { eventSessionId: 'S', previewUrl: 'https://x' } }))).toBeNull()
    expect(parseNestEvent({ message: { data: 'not base64 json' } })).toBeNull()
    expect(parseNestEvent(null)).toBeNull()
  })

  it('always lets a ring through, once per session', () => {
    const g = new NestEventGate()
    const ev = parseNestEvent(update(chime))!
    expect(g.decide(1, ev, now)).toBe('chime')
    expect(g.decide(1, ev, now + 1000)).toBeNull()
    expect(g.decide(1, { ...ev, sessionId: 'S9' }, now + 2000)).toBe('chime')
  })

  it('lets motion through once per camera per few minutes', () => {
    const g = new NestEventGate()
    expect(g.decide(1, parseNestEvent(update(motion('A')))!, now)).toBe('motion')
    expect(g.decide(1, parseNestEvent(update(motion('B')))!, now + 60_000)).toBeNull()
    expect(g.decide(1, parseNestEvent(update(motion('C')))!, now + 60_000 + 3 * 60_000)).toBeNull() // event itself is too old by then
  })

  it('upgrades motion to a person within the same session', () => {
    const g = new NestEventGate()
    expect(g.decide(1, parseNestEvent(update(motion()))!, now)).toBe('motion')
    expect(g.decide(1, parseNestEvent(update(person()))!, now + 1000)).toBe('person')
    expect(g.decide(1, parseNestEvent(update(motion()))!, now + 2000)).toBeNull()
  })

  it('drops events Pub/Sub delivers late', () => {
    expect(new NestEventGate().decide(1, parseNestEvent(update(chime))!, Date.parse(at) + 10 * 60_000)).toBeNull()
  })

  it('keeps households apart', () => {
    const g = new NestEventGate()
    expect(g.decide(1, parseNestEvent(update(motion()))!, now)).toBe('motion')
    expect(g.decide(2, parseNestEvent(update(motion()))!, now)).toBe('motion')
  })

  it('words the notification and opens that camera live', () => {
    const msg = nestEventMessage('chime', { id: 'DOORBELL_abc_456', name: 'Voordeur' }, new Date(at), 'Europe/Amsterdam')
    expect(msg('nl')).toMatchObject({ title: 'Er wordt aangebeld', body: expect.stringContaining('Voordeur, 09:00'), url: '/security?live=DOORBELL_abc_456' })
    expect(nestEventMessage('person', { id: 'C', name: 'Tuin' }, new Date(at), 'Europe/Amsterdam')('en')).toMatchObject({ title: 'Person at Tuin', tag: 'nest-C' })
  })
})
