/**
 * The Tibber app's own GraphQL API (app.tibber.com/v4/gql), signed in with the account's email
 * and password. Unofficial: it is what the Tibber app uses, so it can change with an app update.
 *
 * Used only to do what the owner otherwise does by hand in the Tibber app for a non-integrated
 * car: pick which car is on the charger and enter its battery level, so Tibber's smart charging
 * plans with the right numbers. Tibber keeps controlling the charger.
 */
const LOGIN_URL = 'https://app.tibber.com/v1/login.credentials'
const GQL_URL = 'https://app.tibber.com/v4/gql'
const UA = 'ecoflow-energy/0.1'

export interface TibberAppCredentials {
  email: string
  password: string
}

export interface TibberAppItem {
  id: string
  name: string
}

export interface TibberAppDiscovery {
  homeId: string
  vehicles: TibberAppItem[]
  chargers: TibberAppItem[]
}

type Json = Record<string, any>

// One token per account, reused until shortly before it expires
const tokens = new Map<string, { token: string; exp: number }>()

function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
    if (typeof payload.exp === 'number') return payload.exp * 1000
  } catch {
    // not a JWT: fall through
  }
  return Date.now() + 60 * 60 * 1000
}

async function token(creds: TibberAppCredentials, fresh = false): Promise<string> {
  const cached = tokens.get(creds.email)
  if (cached && !fresh && cached.exp - 5 * 60 * 1000 > Date.now()) return cached.token
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ '@type': 'login', email: creds.email, password: creds.password }),
  })
  if (res.status === 400 || res.status === 401) throw new Error('Tibber login failed: wrong email or password')
  if (!res.ok) throw new Error(`Tibber login HTTP ${res.status}`)
  const body = (await res.json()) as { token?: string }
  if (!body.token) throw new Error('Tibber login returned no token')
  tokens.set(creds.email, { token: body.token, exp: tokenExpiry(body.token) })
  return body.token
}

export function forgetTibberApp(email?: string) {
  if (email) tokens.delete(email)
  else tokens.clear()
}

async function gql<T = Json>(creds: TibberAppCredentials, query: string, variables?: Json): Promise<T> {
  for (const fresh of [false, true]) {
    const t = await token(creds, fresh)
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, Cookie: `token=${t}`, 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query, variables }),
    })
    // Expired or revoked token: sign in once more
    if (res.status === 401 && !fresh) continue
    if (!res.ok) throw new Error(`Tibber app HTTP ${res.status}`)
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (body.errors?.length) throw new Error(`Tibber app: ${body.errors.map((e) => e.message).join('; ')}`)
    if (!body.data) throw new Error('Tibber app: empty response')
    return body.data
  }
  throw new Error('Tibber app: not signed in')
}

/** Field names on the Home type, or null when the API does not allow introspection. */
async function homeFields(creds: TibberAppCredentials): Promise<string[] | null> {
  try {
    const data = await gql<{ __type: { fields: { name: string }[] } | null }>(creds, `{ __type(name: "Home") { fields { name } } }`)
    return data.__type?.fields.map((f) => f.name) ?? null
  } catch {
    return null
  }
}

/** Lists one home's items from the first candidate field that works, trying `name` then `shortName`. */
async function listItems(creds: TibberAppCredentials, homeId: string, fields: string[]): Promise<TibberAppItem[]> {
  const errors: string[] = []
  for (const field of fields) {
    for (const label of ['name', 'shortName']) {
      try {
        const data = await gql(creds, `query ($h: String!) { me { home(id: $h) { ${field} { id ${label} } } } }`, { h: homeId })
        const list = (data.me?.home?.[field] ?? []) as Json[]
        return list.map((x) => ({ id: String(x.id), name: String(x[label] ?? x.id) }))
      } catch (err) {
        errors.push((err as Error).message)
      }
    }
  }
  throw new Error(errors.at(-1) ?? 'no matching field')
}

/** Signs in and finds the home, its cars and its chargers (ids are needed for the settings calls). */
export async function tibberAppDiscover(creds: TibberAppCredentials, preferredHomeId?: string): Promise<TibberAppDiscovery> {
  const homes = await gql<{ me: { homes: { id: string }[] } }>(creds, `{ me { homes { id } } }`)
  const list = homes.me?.homes ?? []
  if (!list.length) throw new Error('No homes on this Tibber account')
  const homeId = list.find((h) => h.id === preferredHomeId)?.id ?? list[0]!.id

  // Field names differ between app versions: use introspection when it is allowed, else known names
  const names = await homeFields(creds)
  const pick = (re: RegExp, fallback: string[]) => {
    const found = names?.filter((n) => re.test(n)) ?? []
    return [...found, ...fallback.filter((f) => !found.includes(f))]
  }
  const vehicles = await listItems(creds, homeId, pick(/^electricVehicles$/i, ['electricVehicles']))
  const chargers = await listItems(creds, homeId, pick(/charger/i, ['evChargers', 'chargers', 'electricVehicleChargers'])).catch(() => [])
  return { homeId, vehicles, chargers }
}

/** "Charging with": which car is connected to the charger. */
export async function tibberAppSetChargerVehicle(creds: TibberAppCredentials, homeId: string, chargerId: string, vehicleId: string) {
  await gql(
    creds,
    `mutation SetVehicleChargerSettings($homeId: String!, $chargerId: String!, $settings: [SettingsItemInput!]) {
      me { home(id: $homeId) { setVehicleChargerSettings(id: $chargerId, homeId: $homeId, settings: $settings) { __typename } } }
    }`,
    { homeId, chargerId, settings: [{ key: 'selectPreferredVehicle', value: vehicleId }] },
  )
}

/** The battery level of a non-integrated car, as entered by hand in the Tibber app (0-100). */
export async function tibberAppSetBatteryLevel(creds: TibberAppCredentials, homeId: string, vehicleId: string, pct: number) {
  await gql(
    creds,
    `mutation SetVehicleSettings($vehicleId: String!, $homeId: String!, $settings: [SettingsItemInput!]) {
      me { setVehicleSettings(id: $vehicleId, homeId: $homeId, settings: $settings) { __typename } }
    }`,
    { vehicleId, homeId, settings: [{ key: 'offline.vehicle.batteryLevel', value: String(pct) }] },
  )
}
