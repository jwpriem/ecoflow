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
  /** What was found, kept in the integration's meta to diagnose an empty car or charger list */
  debug: { homes: { id: string; cars: number }[]; homeFields: string[] | null; probes?: Probe[] }
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
    signal: AbortSignal.timeout(30_000),
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
      signal: AbortSignal.timeout(30_000),
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

type HomeWithCars = { id: string; electricVehicles?: Json[] | null }

/** Every home on the account with its cars, as the app lists them (`me.homes[].electricVehicles`). */
async function homesWithCars(creds: TibberAppCredentials): Promise<{ id: string; vehicles: TibberAppItem[] }[]> {
  let lastError: unknown
  for (const label of ['name', 'shortName']) {
    try {
      const data = await gql<{ me: { homes: HomeWithCars[] } }>(creds, `{ me { homes { id electricVehicles { id ${label} } } } }`)
      return (data.me?.homes ?? []).map((h) => ({
        id: h.id,
        vehicles: (h.electricVehicles ?? []).map((x) => ({ id: String(x.id), name: String(x[label] ?? x.id) })),
      }))
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

interface Probe {
  path: string
  count?: number
  error?: string
}

/**
 * Non-integrated cars may not show up under `electricVehicles`, and the app API allows no
 * introspection. Try the other likely places, and ask for a field that doesn't exist on Me and
 * Home: GraphQL servers answer that with "Did you mean ...?" and so name the real fields.
 */
async function probeCars(creds: TibberAppCredentials, homeId: string): Promise<{ vehicles: TibberAppItem[]; chargers: TibberAppItem[]; probes: Probe[] }> {
  const probes: Probe[] = []
  let vehicles: TibberAppItem[] = []
  let chargers: TibberAppItem[] = []
  const at = (path: string, sel: string) =>
    path.startsWith('home.') ? `query ($h: String!) { me { home(id: $h) { ${path.slice(5)} ${sel} } } }` : `{ me { ${path.slice(3)} ${sel} } }`
  const read = (data: Json, path: string): unknown => (path.startsWith('home.') ? data.me?.home?.[path.slice(5)] : data.me?.[path.slice(3)])

  const lists = ['home.vehicles', 'home.myVehicles', 'home.evs', 'home.cars', 'me.vehicles', 'me.electricVehicles', 'me.myVehicles', 'home.evChargers', 'home.chargers', 'home.electricVehicleChargers']
  for (const path of lists) {
    for (const label of ['name', 'shortName', '']) {
      try {
        const data = await gql(creds, at(path, `{ id ${label} }`), path.startsWith('home.') ? { h: homeId } : undefined)
        const list = ((read(data, path) ?? []) as Json[]).map((x) => ({ id: String(x.id), name: String((label && x[label]) ?? x.id) }))
        probes.push({ path, count: list.length })
        if (/charger/i.test(path)) {
          if (!chargers.length) chargers = list
        } else if (!vehicles.length) vehicles = list
        break
      } catch (err) {
        if (label === '') probes.push({ path, error: (err as Error).message.slice(0, 300) })
      }
    }
  }
  // Unknown fields: the error text lists the closest real ones
  for (const path of ['home.vehicle', 'me.vehicle', 'home.charger']) {
    try {
      await gql(creds, at(path, '{ id }'), path.startsWith('home.') ? { h: homeId } : undefined)
    } catch (err) {
      probes.push({ path, error: (err as Error).message.slice(0, 300) })
    }
  }
  return { vehicles, chargers, probes }
}

/**
 * Signs in and finds the home with the cars, its cars and its charger (ids are needed for the
 * settings calls). An account can have several homes (an old address, a cabin): the cars are on
 * one of them, so prefer the given home only when it has cars.
 */
export async function tibberAppDiscover(creds: TibberAppCredentials, preferredHomeId?: string): Promise<TibberAppDiscovery> {
  const homes = await homesWithCars(creds)
  if (!homes.length) throw new Error('No homes on this Tibber account')
  const preferred = homes.find((h) => h.id === preferredHomeId)
  const home = (preferred?.vehicles.length ? preferred : homes.find((h) => h.vehicles.length)) ?? preferred ?? homes[0]!

  // There is no known query for chargers: look for a charger field on Home when introspection is allowed
  const names = await homeFields(creds)
  const found = names?.filter((n) => /charger/i.test(n)) ?? []
  const candidates = [...found, ...['evChargers', 'chargers', 'electricVehicleChargers'].filter((f) => !found.includes(f))]
  let chargers = await listItems(creds, home.id, candidates).catch(() => [] as TibberAppItem[])
  let vehicles = home.vehicles
  let probes: Probe[] | undefined
  if (!vehicles.length || !chargers.length) {
    const found = await probeCars(creds, home.id)
    probes = found.probes
    if (!vehicles.length) vehicles = found.vehicles
    if (!chargers.length) chargers = found.chargers
  }
  return {
    homeId: home.id,
    vehicles,
    chargers,
    debug: {
      homes: homes.map((h) => ({ id: h.id, cars: h.vehicles.length })),
      homeFields: names?.filter((n) => /charg|vehicle|device/i.test(n)) ?? null,
      probes,
    },
  }
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
  const settings = [{ key: 'offline.vehicle.batteryLevel', value: String(pct) }]
  try {
    await gql(
      creds,
      `mutation SetVehicleSettings($vehicleId: String!, $homeId: String!, $settings: [SettingsItemInput!]) {
        me { setVehicleSettings(id: $vehicleId, homeId: $homeId, settings: $settings) { __typename } }
      }`,
      { vehicleId, homeId, settings },
    )
  } catch {
    // Newer app versions dropped the homeId argument
    await gql(
      creds,
      `mutation SetVehicleSettings($vehicleId: String!, $settings: [SettingsItemInput!]) {
        me { setVehicleSettings(id: $vehicleId, settings: $settings) { __typename } }
      }`,
      { vehicleId, settings },
    )
  }
}
