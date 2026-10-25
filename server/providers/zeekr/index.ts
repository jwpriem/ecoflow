import { randomUUID } from 'node:crypto'
import { appSignatureHeaders, encryptPassword, encryptVin, hmacHeaders } from './sign'

/**
 * Client for the Zeekr app API (the same undocumented gateway the Zeekr phone app uses),
 * ported from github.com/Fryyyyy/zeekr_ev_api. Read-only: it logs in, lists the vehicles on
 * the account (including shared cars) and reads each car's status. No command is ever sent.
 *
 * The six signing secrets are extracted once from the Android app; see the project memory.
 * A region lookup picks the EU hosts and login server for EU accounts.
 */

const UA = 'okhttp/4.12.0'

const SEA_APP_SERVER = 'https://gateway-pub-hw-em-sg.zeekrlife.com/overseas-app/'
const EU_APP_SERVER = 'https://gateway-pub-azure.zeekr.eu/overseas-app/'
const EU_USERCENTER = 'https://gateway-pub-azure.zeekr.eu/zeekr-cuc-idaas/'

const URL_PATH = 'region/url'
const CHECKUSER_PATH = 'auth/checkUserV2'
const LOGIN_PATH = 'auth/loginByEmailEncrypt'
const USERINFO_PATH = 'user/info'
const PROTOCOL_PATH = 'protocol/service/getProtocol'
const INBOX_PATH = 'member/inbox/home'
const TSPCODE_PATH = 'user/tspCode'
const UPDATELANG_PATH = 'user/updateLanguage'
const BEARERLOGIN_PATH = 'ms-user-auth/v1.0/auth/login'
const VEHLIST_PATH = 'ms-app-bff/api/v4.0/veh/vehicle-list'
const VEHSTATUS_PATH = 'ms-vehicle-status/api/v1.0/vehicle/status/latest'
const VEHCHARGE_PATH = 'ms-vehicle-status/api/v1.0/vehicle/status/qrvs'
const CHARGELIMIT_PATH = 'ms-charge-manage/api/v1.0/charge/getLatestSoc'

const CLIENT_ID = '1JwLroFkFFIpgFGdTRrm4_nzkkwDkfHj7RxJQb7J8tc'

const REGION_LOGIN_SERVERS: Record<string, string> = {
  SEA: 'https://sea-snc-tsp-api-gw.zeekrlife.com/',
  UAE: 'https://me-snc-tsp-api-gw.zeekrlife.com/',
  LA: 'https://la-snc-tsp-api-gw.zeekrlife.com/',
  EU: 'https://eu-snc-tsp-api-gw.zeekrlife.com/',
}

function defaultHeaders(countryCode: string): Record<string, string> {
  return {
    'accept-encoding': 'gzip',
    'accept-language': 'en-AU',
    'app-authorization': '1003',
    'app-code': '32816dbd-ff17-47b7-e250-5dae7d9f8cd4',
    appcode: 'eu-app',
    appid: 'TSP',
    appsecret: 'zeekr_tis',
    appversion: '1.4.1',
    'call-source': 'android',
    'client-id': CLIENT_ID,
    'Content-Type': 'application/json; charset=UTF-8',
    country: countryCode,
    'device-name': 'sdk_gphone64_x86_64',
    'device-type': 'app',
    language: 'en',
    msgappid: '11002',
    msgclientid: '1003',
    registcountry: countryCode,
    'tmp-tenant-code': '3300743799505195008',
    'user-agent': 'Device/GoogleAppName/com.zeekr.globalAppVersion/1.4.1Platform/androidOSVersion/16Ditto/true',
  }
}

function loggedInHeaders(deviceId: string, projectId: string, bearer: string): Record<string, string> {
  return {
    'Accept-Encoding': 'gzip',
    'ACCEPT-LANGUAGE': 'en-AU',
    AppId: 'ONEX97FB91F061405',
    authorization: bearer,
    'Content-Type': 'application/json; charset=UTF-8',
    'user-agent': UA,
    'X-API-SIGNATURE-VERSION': '2.0',
    'X-APP-ID': 'ZEEKRCNCH001M0001',
    'x-app-os-version': '',
    'x-device-id': deviceId,
    'x-p': 'Android',
    'X-PLATFORM': 'APP',
    'X-PROJECT-ID': projectId,
  }
}

export interface ZeekrCredentials {
  username: string
  password: string
  hmacAccessKey: string
  hmacSecretKey: string
  passwordPublicKey: string
  prodSecret: string
  vinKey: string
  vinIv: string
  /** Account country, used to pick the gateway region. Default NL (EU). */
  countryCode?: string
}

/** A logged-in session, cached in memory and reused until the token expires. */
export interface ZeekrSession {
  authToken: string
  bearerToken: string
  appServerHost: string
  userCenterHost: string
  regionCode: string
  regionLoginServer: string
  deviceId: string
  projectId: string
}

export interface VehicleSummary {
  vin: string
  name: string
  model: string | null
  plateNo: string | null
  raw: Record<string, unknown>
}

export interface VehicleReading {
  soc: number | null // 0-1
  rangeKm: number | null
  charging: boolean
  pluggedIn: boolean
  chargePowerW: number | null
  targetSoc: number | null // 0-1
  lat: number | null
  lon: number | null
  online: boolean
  statusAt: string | null
}

class ZeekrError extends Error {}

type Json = Record<string, any>

const asNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

async function sendJson(url: string, method: string, headers: Record<string, string>, body?: string): Promise<Json> {
  const res = await fetch(url, { method, headers, body })
  const text = await res.text()
  let data: Json
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new ZeekrError(`Zeekr ${method} ${new URL(url).pathname}: non-JSON response (HTTP ${res.status})`)
  }
  return data
}

/** HMAC-signed call (login / user-center flow). */
async function hmacCall(creds: ZeekrCredentials, authToken: string | undefined, method: string, url: string, body?: Json): Promise<Json> {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const headers = { ...defaultHeaders(creds.countryCode || 'NL') }
  if (authToken) headers.authorization = authToken
  Object.assign(headers, hmacHeaders(method, url, payload, creds.hmacAccessKey, creds.hmacSecretKey))
  return sendJson(url, method, headers, body === undefined ? undefined : payload)
}

/** App-signed call (bearer-token flow: bearer login, vehicle list and status). */
async function appCall(
  creds: ZeekrCredentials,
  session: Pick<ZeekrSession, 'bearerToken' | 'deviceId' | 'projectId'>,
  method: string,
  url: string,
  body?: Json,
  vin?: string,
): Promise<Json> {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const headers = loggedInHeaders(session.deviceId, session.projectId, session.bearerToken)
  if (vin) headers['X-VIN'] = encryptVin(vin, creds.vinKey, creds.vinIv)
  const signed = appSignatureHeaders(method, url, headers, payload, creds.prodSecret)
  return sendJson(url, method, signed, payload)
}

async function resolveRegion(creds: ZeekrCredentials): Promise<{ appServerHost: string; userCenterHost: string; regionCode: string }> {
  const country = (creds.countryCode || 'NL').toLowerCase()
  try {
    const seaList = await hmacCall(creds, undefined, 'GET', `${SEA_APP_SERVER}${URL_PATH}`)
    if (seaList.success) {
      for (const block of (seaList.data as Json[]) ?? []) {
        if (String(block.countryCode ?? '').toLowerCase() === country) {
          const url = block.url ?? {}
          const host = (h: string) => (h.endsWith('/') ? h : `${h}/`)
          return {
            appServerHost: host(String(url.appServerUrl ?? '')),
            userCenterHost: host(String(url.userCenterUrl ?? '')),
            regionCode: String(block.regionCode ?? 'SEA'),
          }
        }
      }
    }
  } catch {
    // SEA gateway unreachable: fall through to the EU hosts, which is what EU accounts use.
  }
  // Not in the SEA list (or it was unreachable): assume EU, the only other region we support.
  return { appServerHost: EU_APP_SERVER, userCenterHost: EU_USERCENTER, regionCode: 'EU' }
}

/** Runs the full login handshake and returns a session with a bearer token. */
export async function zeekrLogin(creds: ZeekrCredentials): Promise<ZeekrSession> {
  const { appServerHost, userCenterHost, regionCode } = await resolveRegion(creds)
  const regionLoginServer = REGION_LOGIN_SERVERS[regionCode]
  if (!regionLoginServer) throw new ZeekrError(`No login server for region ${regionCode}`)
  const projectId = regionCode === 'EU' ? 'ZEEKR_EU' : regionCode === 'LA' ? 'ZEEKR_LA' : 'ZEEKR_SEA'
  const deviceId = randomUUID()

  const check = await hmacCall(creds, undefined, 'POST', `${userCenterHost}${CHECKUSER_PATH}`, { email: creds.username, checkType: '1' })
  if (!check.success) throw new ZeekrError('Account check failed: wrong email, or the keys do not match this app version')

  const login = await hmacCall(creds, undefined, 'POST', `${userCenterHost}${LOGIN_PATH}`, {
    code: '',
    codeId: '',
    email: creds.username,
    password: encryptPassword(creds.password, creds.passwordPublicKey),
  })
  if (!login.success) throw new ZeekrError(`Login failed: ${login.msg ?? login.code ?? 'wrong email or password'}`)
  const authToken = login.data?.tokenValue
  if (!authToken) throw new ZeekrError('Login returned no token')

  // Best-effort side calls the app makes; failures here do not stop login.
  await hmacCall(creds, authToken, 'POST', `${userCenterHost}${USERINFO_PATH}`).catch(() => undefined)
  await hmacCall(creds, authToken, 'POST', `${appServerHost}${PROTOCOL_PATH}`, { country: creds.countryCode || 'NL' }).catch(() => undefined)
  await hmacCall(creds, authToken, 'GET', `${appServerHost}${INBOX_PATH}`).catch(() => undefined)

  const tsp = await hmacCall(creds, authToken, 'GET', `${userCenterHost}${TSPCODE_PATH}?tspClientId=${CLIENT_ID}`)
  const tspCode = tsp.data?.code
  if (!tspCode) throw new ZeekrError('Could not fetch the TSP code')
  await hmacCall(creds, authToken, 'GET', `${userCenterHost}${UPDATELANG_PATH}?language=en`).catch(() => undefined)

  const bearerBody = {
    identifier: tspCode,
    identityType: 10,
    loginDeviceId: 'google-sdk_gphone64_x86_64-36-16',
    loginDeviceJgId: '',
    loginDeviceType: 1,
    loginPhoneBrand: 'google',
    loginPhoneModel: 'sdk_gphone64_x86_64',
    loginSystem: 'Android',
  }
  const bearer = await appCall(creds, { bearerToken: '', deviceId, projectId }, 'POST', `${regionLoginServer}${BEARERLOGIN_PATH}`, bearerBody)
  if (!bearer.success) throw new ZeekrError(`Bearer login failed: ${bearer.msg ?? bearer.code ?? 'unknown'}`)
  const bearerToken = bearer.data?.accessToken
  if (!bearerToken) throw new ZeekrError('Bearer login returned no access token')

  return { authToken, bearerToken, appServerHost, userCenterHost, regionCode, regionLoginServer, deviceId, projectId }
}

export async function zeekrVehicleList(creds: ZeekrCredentials, session: ZeekrSession): Promise<VehicleSummary[]> {
  const res = await appCall(creds, session, 'GET', `${session.regionLoginServer}${VEHLIST_PATH}?needSharedCar=true`)
  if (!res.success) throw new ZeekrError(`Vehicle list failed: ${res.msg ?? res.code ?? 'unknown'}`)
  return ((res.data as Json[]) ?? []).map((v) => ({
    vin: String(v.vin),
    name: String(v.seriesName || v.vehicleName || v.modelName || v.plateNo || v.vin),
    model: (v.seriesName || v.modelName || v.vehicleModelName || null) as string | null,
    plateNo: (v.plateNo ?? null) as string | null,
    raw: v,
  }))
}

/** Reads one car's status, charging status and target SoC. Returns null fields when the car is asleep. */
export async function zeekrVehicleReading(creds: ZeekrCredentials, session: ZeekrSession, vin: string): Promise<VehicleReading> {
  const status = await appCall(creds, session, 'GET', `${session.regionLoginServer}${VEHSTATUS_PATH}?latest=false&target=new`, undefined, vin)
  const data: Json = status.success ? (status.data ?? {}) : {}
  const ev: Json = data.additionalVehicleStatus?.electricVehicleStatus ?? {}
  const basic: Json = data.basicVehicleStatus ?? {}
  const pos: Json = basic.position ?? {}

  const chargerState = asNum(ev.chargerState)
  const charging = chargerState != null && [1, 2, 15].includes(chargerState)
  const pluggedIn = !!asNum(ev.statusOfChargerConnection)

  let chargePowerW: number | null = null
  try {
    const charge = await appCall(creds, session, 'GET', `${session.regionLoginServer}${VEHCHARGE_PATH}`, undefined, vin)
    const kw = asNum(charge.success ? charge.data?.chargePower : null)
    if (kw != null) chargePowerW = Math.round(kw * 1000)
  } catch {
    // charging-status endpoint is only meaningful while plugged in; ignore failures
  }

  let targetSoc: number | null = null
  try {
    const limit = await appCall(creds, session, 'GET', `${session.regionLoginServer}${CHARGELIMIT_PATH}`, undefined, vin)
    const raw = asNum(limit.success ? limit.data?.soc : null)
    if (raw != null) targetSoc = raw / 1000 // API returns percent x 10 (e.g. 800 -> 80% -> 0.8)
  } catch {
    // ignore
  }

  const socPct = asNum(ev.chargeLevel)
  return {
    soc: socPct != null ? socPct / 100 : null,
    rangeKm: asNum(ev.distanceToEmptyOnBatteryOnly),
    charging,
    pluggedIn,
    chargePowerW,
    targetSoc,
    lat: asNum(pos.latitude),
    lon: asNum(pos.longitude),
    online: status.success === true,
    statusAt: data.updateTime ? String(data.updateTime) : null,
  }
}
