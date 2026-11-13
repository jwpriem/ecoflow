import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DOORBELL, doorbellSettings, findSpeaker, isPlayerId, sonosSpeakers } from '../server/lib/sonos'
import { resetProviders } from '../server/providers/http'
import { sonosAudioClip, sonosAuthorizeUrl, SonosError, sonosExchangeCode, sonosPlayersOf, sonosRefresh, sonosTokenNeedsRefresh } from '../server/providers/sonos'

afterEach(() => {
  vi.unstubAllGlobals()
  resetProviders()
})

const creds = { clientId: 'key-1', clientSecret: 'secret-1' }
const auth = { accessToken: 'AT', clientId: 'key-1' }

describe('sonosSpeakers', () => {
  const speakers = sonosSpeakers([
    {
      id: 'HH1',
      players: [
        { id: 'RINCON_PLAY1', name: 'Slaapkamer', capabilities: ['PLAYBACK'] },
        { id: 'RINCON_MOVE', name: 'Keuken', capabilities: ['PLAYBACK', 'AUDIO_CLIP', 'VOICE'] },
        { id: 'RINCON_BEAM', name: 'Woonkamer', capabilities: ['PLAYBACK', 'AUDIO_CLIP', 'HT_PLAYBACK'] },
      ],
    },
    { id: 'HH2', players: [{ id: 'RINCON_MOVE', name: 'Keuken', capabilities: ['AUDIO_CLIP'] }] },
  ])

  it('lists the speakers that can play a clip first, by name, each once', () => {
    expect(speakers.map((s) => s.id)).toEqual(['RINCON_MOVE', 'RINCON_BEAM', 'RINCON_PLAY1'])
    expect(speakers[0]).toEqual({ id: 'RINCON_MOVE', name: 'Keuken', householdId: 'HH1', audioClip: true })
    expect(speakers[2]!.audioClip).toBe(false)
  })

  it('finds the speaker again by name when its ID changed', () => {
    const moved = [{ ...speakers[0]!, id: 'RINCON_NEW' }]
    expect(findSpeaker(moved, { playerId: 'RINCON_MOVE', playerName: 'Keuken' })?.id).toBe('RINCON_NEW')
    expect(findSpeaker(moved, { playerId: 'RINCON_MOVE', playerName: null })).toBeNull()
  })
})

describe('doorbellSettings', () => {
  it('fills in defaults and clamps the volume', () => {
    expect(doorbellSettings({})).toEqual(DEFAULT_DOORBELL)
    expect(doorbellSettings({ doorbell: { enabled: true, playerId: 'RINCON_MOVE', playerName: 'Keuken', volume: 400, sound: 'chime' } })).toEqual({
      enabled: true,
      playerId: 'RINCON_MOVE',
      playerName: 'Keuken',
      volume: 100,
      sound: 'chime',
    })
    expect(doorbellSettings({ doorbell: { volume: 'x', sound: 'airhorn' } })).toMatchObject({ volume: 45, sound: 'dingdong' })
  })

  it('only lets player IDs through that look like one', () => {
    expect(isPlayerId('RINCON_347E5C0E1A2B01400')).toBe(true)
    expect(isPlayerId('../households')).toBe(false)
    expect(isPlayerId(null)).toBe(false)
  })
})

describe('Sonos sign-in', () => {
  it('sends the owner to Sonos with the playback scope and our redirect URI', () => {
    const u = new URL(sonosAuthorizeUrl('key-1', 'https://www.wattswise.eu/api/integrations/sonos/callback', 'S'))
    expect(u.origin + u.pathname).toBe('https://api.sonos.com/login/v3/oauth')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'key-1',
      response_type: 'code',
      state: 'S',
      scope: 'playback-control-all',
      redirect_uri: 'https://www.wattswise.eu/api/integrations/sonos/callback',
    })
  })

  it('swaps the code with Basic auth and the same redirect URI', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 86400 }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const t = await sonosExchangeCode(creds, 'CODE', 'https://x/cb')
    expect(t).toMatchObject({ accessToken: 'A', refreshToken: 'R' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.sonos.com/login/v3/oauth/access')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('key-1:secret-1').toString('base64')}`)
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ grant_type: 'authorization_code', code: 'CODE', redirect_uri: 'https://x/cb' })
  })

  it('keeps the refresh token when a refresh hands out none, and calls a refused one auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'B', expires_in: 86400 }), { status: 200 })))
    expect((await sonosRefresh({ ...creds, refreshToken: 'R' })).refreshToken).toBe('R')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    await expect(sonosRefresh({ ...creds, refreshToken: 'R' })).rejects.toMatchObject({ kind: 'auth' })
  })

  it('refreshes with an hour to spare', () => {
    const now = 1_000_000_000
    expect(sonosTokenNeedsRefresh(undefined, now)).toBe(true)
    expect(sonosTokenNeedsRefresh(now + 30 * 60_000, now)).toBe(true)
    expect(sonosTokenNeedsRefresh(now + 5 * 3600_000, now)).toBe(false)
  })
})

describe('audioClip', () => {
  it('plays our sound on the player at the volume asked, at high priority', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'clip-1', status: 'ACTIVE' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await sonosAudioClip(auth, 'RINCON_MOVE', { name: 'Deurbel', volume: 55, streamUrl: 'https://www.wattswise.eu/sounds/deurbel.mp3' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.ws.sonos.com/control/api/v1/players/RINCON_MOVE/audioClip')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer AT')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Deurbel',
      appId: 'eu.wattswise.app',
      priority: 'HIGH',
      clipType: 'CUSTOM',
      streamUrl: 'https://www.wattswise.eu/sounds/deurbel.mp3',
      volume: 55,
    })
  })

  it('uses Sonos’ own chime without a URL', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await sonosAudioClip(auth, 'RINCON_MOVE', { name: 'Deurbel', volume: 140 })
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ clipType: 'CHIME', volume: 100 })
    expect(body.streamUrl).toBeUndefined()
  })

  it('marks an unknown player as gone, so the speaker is looked up again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errorCode: 'ERROR_RESOURCE_GONE', reason: 'player gone' }), { status: 410 })))
    const err = await sonosAudioClip(auth, 'RINCON_OLD', { name: 'Deurbel', volume: 50 }).catch((e) => e)
    expect(err).toBeInstanceOf(SonosError)
    expect(err).toMatchObject({ kind: 'gone', status: 410, message: 'Sonos: player gone' })
  })

  it('reads the players of a household from its groups', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ groups: [], players: [{ id: 'RINCON_MOVE', name: 'Keuken', capabilities: ['AUDIO_CLIP'] }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await sonosPlayersOf(auth, 'Sonos_HH.1')).toHaveLength(1)
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://api.ws.sonos.com/control/api/v1/households/Sonos_HH.1/groups')
  })
})
