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
    // A query the schema rejects comes back as 400 with the reason in the GraphQL errors
    const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] }
    if (!res.ok) {
      const why = body.errors?.map((e) => e.message).join('; ')
      throw new Error(`Tibber app HTTP ${res.status}${why ? `: ${why}` : ''}`)
    }
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

/** `me.a.b` -> `{ me { a { b { <sel> } } } }`; `home.a` reads under the given home. */
function pathQuery(path: string, sel: string): string {
  const [root, ...rest] = path.split('.')
  const inner = rest.reduceRight((acc, f) => `${f} { ${acc} }`, sel)
  return root === 'home' ? `query ($h: String!) { me { home(id: $h) { ${inner} } } }` : `{ me { ${inner} } }`
}

function readPath(data: Json, path: string): unknown {
  const [root, ...rest] = path.split('.')
  let x: any = root === 'home' ? data.me?.home : data.me
  for (const f of rest) x = x?.[f]
  return x
}

// Where the app may list cars and chargers. Non-integrated cars are not in `home.electricVehicles`;
// `me.myVehicles` exists (an object, not a list), so its list is one level down.
const VEHICLE_LISTS = ['me.myVehicles.vehicles', 'me.myVehicles.items', 'me.myVehicles.electricVehicles', 'me.myVehicles.list']
// `home.evCharger` is one charger, not a list
const CHARGER_LISTS = ['home.evCharger', 'home.evChargers']
// Asked with `{ id }` only for the error text: it says whether the field exists and names its type
const EXISTS: string[] = []
// Fields that may tell the cars apart: the app titles every non-integrated Zeekr just "Zeekr"
const VEHICLE_DETAILS = ['subtitle', 'shortName', 'name', 'model', 'modelName', 'brand', 'make', 'description', 'displayName', 'batteryCapacity', 'batteryCapacityKwh']

/**
 * Non-integrated cars may not show up under `electricVehicles`, and the app API allows no
 * introspection. Try the other likely places and keep each error: the text names the field's type
 * or its required arguments, which shows where to look next.
 */
async function probeCars(creds: TibberAppCredentials, homeId: string): Promise<{ vehicles: TibberAppItem[]; chargers: TibberAppItem[]; probes: Probe[] }> {
  const probes: Probe[] = []
  const vars = (path: string) => (path.startsWith('home.') ? { h: homeId } : undefined)

  async function firstList(paths: string[]): Promise<TibberAppItem[]> {
    for (const path of paths) {
      let lastError = ''
      for (const label of ['title', 'name', 'shortName', '']) {
        try {
          const data = await gql(creds, pathQuery(path, `id ${label}`), vars(path))
          const raw = readPath(data, path)
          const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && 'id' in raw ? [raw as Json] : null
          if (!items) {
            lastError = `not a list: ${JSON.stringify(raw)?.slice(0, 200)}`
            continue
          }
          const list = items.filter((x: Json) => x?.id).map((x: Json) => ({ id: String(x.id), name: String((label && x[label]) || x.id) }))
          probes.push({ path, count: list.length })
          if (list.length) return list
          lastError = ''
          break
        } catch (err) {
          lastError = (err as Error).message.slice(0, 300)
        }
      }
      if (lastError) probes.push({ path, error: lastError })
    }
    return []
  }

  const vehicles = await firstList(VEHICLE_LISTS)
  const chargers = await firstList(CHARGER_LISTS)
  if (vehicles.length > 1 && new Set(vehicles.map((v) => v.name)).size < vehicles.length) {
    await addVehicleDetails(creds, vehicles, probes)
  }
  for (const path of EXISTS) {
    try {
      await gql(creds, pathQuery(path, 'id'), vars(path))
      probes.push({ path, error: 'ok' })
    } catch (err) {
      probes.push({ path, error: (err as Error).message.slice(0, 300) })
    }
  }
  return { vehicles, chargers, probes }
}

/** Adds what each detail field says to the car names, so cars with the same title can be told apart. */
async function addVehicleDetails(creds: TibberAppCredentials, vehicles: TibberAppItem[], probes: Probe[]) {
  for (const field of VEHICLE_DETAILS) {
    const path = `me.myVehicles.vehicles.${field}`
    try {
      const data = await gql(creds, `{ me { myVehicles { vehicles { id ${field} } } } }`)
      const list = (data.me?.myVehicles?.vehicles ?? []) as Json[]
      probes.push({ path, error: `ok: ${JSON.stringify(list.map((x) => x[field])).slice(0, 200)}` })
      for (const x of list) {
        const v = vehicles.find((c) => c.id === String(x.id))
        const value = x[field]
        if (!v || value == null || typeof value === 'object') continue
        const text = typeof value === 'number' && /capacity/i.test(field) ? `${value} kWh` : String(value).trim()
        if (text && !v.name.toLowerCase().includes(text.toLowerCase())) v.name = `${v.name} ${text}`
      }
    } catch (err) {
      probes.push({ path, error: (err as Error).message.slice(0, 300) })
    }
  }
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
