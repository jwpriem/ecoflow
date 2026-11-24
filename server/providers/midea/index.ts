import { randomBytes } from 'node:crypto'
import { providerCall } from '../http'
import { type AcControl, type AcState, lanPacket, parseReply, setFrame, statusFrame } from './ac'
import {
  aesDecryptHex,
  aesEncryptHex,
  bytesToCsv,
  csvToBytes,
  dataKeys,
  encryptAccount,
  encryptIamPassword,
  encryptPassword,
  MIDEA_APP,
  mideaDeviceId,
  signRequest,
} from './crypto'

/**
 * Client for the Midea SmartHome cloud (the app formerly called MSmartHome). There is no public API: this is the
 * app's own gateway, as midea-beautiful-air and midea-local talk to it, and it can change with an app update.
 *
 * Login: the account router says on which regional server the account lives (an account from the Netherlands
 * can sit on the US server), then a login there. The air conditioner is read and set with the same bytes the app
 * sends on the home network, wrapped and encrypted, through `/v1/appliance/transparent/send`; the cloud passes
 * them on to the unit and returns its answer.
 */

const DEFAULT_SERVER = 'https://mp-prod.appsmb.com/mas/v5/app/proxy?alias='
const APP_VERSION = '2.22.0'
const OS_VERSION = '8.1.0'

export interface MideaCredentials {
  email: string
  password: string
}

export interface MideaSession {
  /** The regional server, ending in `?alias=` */
  server: string
  deviceId: string
  uid: string
  /** Header token (mdata.accessToken) */
  accessToken: string
  /** Key and IV for the commands */
  key: string
  iv: string
}

export interface MideaAppliance {
  /** The cloud's appliance code: what the commands address */
  id: string
  name: string
  /** e.g. 0xAC for an air conditioner */
  type: string
  online: boolean
}

export class MideaError extends Error {
  constructor(
    message: string,
    readonly code: number,
    /** auth: wrong e-mail or password; session: log in again; limit: too many devices logged in; other */
    readonly kind: 'auth' | 'session' | 'limit' | 'locked' | 'other',
  ) {
    super(message)
  }
}

const KINDS: Record<number, MideaError['kind']> = { 3101: 'auth', 3102: 'auth', 3106: 'session', 3144: 'session', 65027: 'limit', 7610: 'locked' }
const MESSAGES: Partial<Record<MideaError['kind'], string>> = {
  auth: 'Midea did not accept this e-mail address and password',
  limit: 'Too many devices are signed in to this Midea account. Sign out elsewhere, or use a second account the air conditioner is shared with',
  locked: 'Midea locked the account for a few minutes after failed logins',
}

/** Only Midea's own hosts: the router's answer decides where the password goes */
export function isMideaServer(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /(^|\.)(appsmb\.com|smartmidea\.net)$/.test(u.hostname) && url.endsWith('?alias=')
  } catch {
    return false
  }
}

const stamp = (d = new Date()) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}`
const reqId = () => randomBytes(16).toString('hex')

/** The fields the app sends with every request */
function general(deviceId: string, uid = ''): Record<string, unknown> {
  return {
    appId: MIDEA_APP.appId,
    format: 2,
    clientType: 1,
    language: 'en_US',
    src: MIDEA_APP.appId,
    stamp: stamp(),
    deviceId,
    appVNum: APP_VERSION,
    appVersion: APP_VERSION,
    clientVersion: APP_VERSION,
    platformId: '1',
    reqId: reqId(),
    retryCount: '3',
    uid,
    userType: '0',
  }
}

const basic = Buffer.from(`${MIDEA_APP.appKey}:${MIDEA_APP.iotKey}`).toString('base64')

async function post<T>(server: string, endpoint: string, body: Record<string, unknown>, session?: Pick<MideaSession, 'uid' | 'accessToken'>): Promise<T> {
  const json = JSON.stringify(body)
  const random = String(Math.floor(Date.now() / 1000))
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-recipe-app': String(MIDEA_APP.appId),
    Authorization: `Basic ${basic}`,
    sign: signRequest(json, random),
    secretVersion: '1',
    random,
    version: APP_VERSION,
    systemVersion: OS_VERSION,
    platform: '0',
    ...(session ? { uid: session.uid, accessToken: session.accessToken } : {}),
  }
  const res = await providerCall('midea', (signal) => fetch(server + endpoint, { method: 'POST', headers, body: json, signal }), { timeoutMs: 15_000 })
  if (!res.ok) throw new MideaError(`Midea answered HTTP ${res.status}`, res.status, res.status === 401 ? 'session' : 'other')
  const out = (await res.json().catch(() => null)) as { code?: string | number; msg?: string; data?: T } | null
  if (!out) throw new MideaError('Midea sent an answer we cannot read', 0, 'other')
  const code = Number(out.code ?? 0)
  if (code !== 0) {
    const kind = KINDS[code] ?? 'other'
    throw new MideaError(`${MESSAGES[kind] ?? `Midea: ${out.msg ?? 'error'}`} (${code})`, code, kind)
  }
  return out.data as T
}

/** Which regional server holds the account; the default server when the router doesn't know */
async function findServer(account: string, deviceId: string): Promise<string> {
  try {
    const r = await post<{ masUrl?: string } | null>(DEFAULT_SERVER, '/v1/unitcenter/router/user/name', {
      ...general(deviceId),
      clientType: 8,
      clientSrc: 8,
      userName: encryptAccount(account),
    })
    if (r?.masUrl && isMideaServer(r.masUrl)) return r.masUrl
  } catch (err) {
    if (err instanceof MideaError && err.kind !== 'other') throw err
  }
  return DEFAULT_SERVER
}

export async function mideaLogin(creds: MideaCredentials): Promise<MideaSession> {
  const account = creds.email.trim().toLowerCase()
  const deviceId = mideaDeviceId(account)
  const server = await findServer(account, deviceId)
  // Skip the old region lookup (/v1/multicloud/platform/user/route): it doesn't know accounts on another server (10004)
  const { loginId } = await post<{ loginId: string }>(server, '/v1/user/login/id/get', { ...general(deviceId), loginAccount: account })
  const s = stamp()
  const login = await post<{ uid: string; accessToken: string; randomData: string; mdata?: { accessToken?: string } }>(server, '/mj/user/login', {
    data: { appKey: MIDEA_APP.appKey, appVersion: APP_VERSION, osVersion: OS_VERSION, deviceId, platform: '2' },
    iotData: {
      appId: String(MIDEA_APP.appId),
      appVNum: APP_VERSION,
      appVersion: APP_VERSION,
      clientType: 1,
      clientVersion: APP_VERSION,
      format: 2,
      language: 'en_US',
      iampwd: encryptIamPassword(loginId, creds.password),
      loginAccount: account,
      password: encryptPassword(loginId, creds.password),
      pushToken: randomBytes(90).toString('base64url'),
      pushType: '4',
      reqId: reqId(),
      retryCount: '3',
      src: '10',
      stamp: s,
    },
    reqId: reqId(),
    stamp: s,
  })
  if (!login?.mdata?.accessToken || !login.accessToken || !login.randomData) throw new MideaError('Midea login returned no session', 0, 'other')
  return { server, deviceId, uid: String(login.uid), accessToken: login.mdata.accessToken, ...dataKeys(login.accessToken, login.randomData) }
}

export async function mideaAppliances(session: MideaSession): Promise<MideaAppliance[]> {
  const r = await post<{ list?: { id: string | number; name?: string; type?: string; onlineStatus?: string | number }[] }>(
    session.server,
    '/v1/appliance/user/list/get',
    general(session.deviceId, session.uid),
    session,
  )
  return (r?.list ?? []).map((a) => ({ id: String(a.id), name: a.name ?? String(a.id), type: String(a.type ?? '').toUpperCase().replace('0X', '0x'), online: a.onlineStatus == null || String(a.onlineStatus) === '1' }))
}

/**
 * One message to the unit and its answer. The gateway refuses any field it doesn't know, so this sends exactly
 * the ones it lists (not the extra app fields of the other calls).
 */
async function transparentSend(session: MideaSession, applianceId: string, frame: Uint8Array): Promise<Uint8Array> {
  const order = aesEncryptHex(bytesToCsv(lanPacket(applianceId, frame)), session.key, session.iv)
  const r = await post<{ reply?: string }>(
    session.server,
    '/v1/appliance/transparent/send',
    {
      appId: String(MIDEA_APP.appId),
      src: String(MIDEA_APP.appId),
      format: '2',
      clientType: '1',
      language: 'en_US',
      stamp: stamp(),
      deviceId: session.deviceId,
      reqId: reqId(),
      uid: session.uid,
      order,
      funId: '0000',
      applianceCode: applianceId,
    },
    session,
  )
  if (!r?.reply) throw new MideaError('The air conditioner did not answer', 0, 'other')
  return csvToBytes(aesDecryptHex(r.reply, session.key, session.iv))
}

export async function mideaAcStatus(session: MideaSession, applianceId: string): Promise<AcState> {
  const state = parseReply(await transparentSend(session, applianceId, statusFrame()))
  if (!state) throw new MideaError('The air conditioner sent no status', 0, 'other')
  return state
}

/** Sets everything in `control`; returns the status the unit reports afterwards */
export async function mideaAcSet(session: MideaSession, applianceId: string, control: AcControl): Promise<AcState> {
  const answer = parseReply(await transparentSend(session, applianceId, setFrame(control)))
  return answer ?? mideaAcStatus(session, applianceId)
}
