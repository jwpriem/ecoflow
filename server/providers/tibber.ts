const API = 'https://api.tibber.com/v1-beta/gql'
const UA = 'ecoflow-energy/0.1'

export interface TibberCredentials {
  token: string
}

export interface TibberPrice {
  startsAt: string
  total: number
  energy: number
  tax: number
}

export interface TibberHome {
  id: string
  appNickname: string | null
  address: { address1: string | null } | null
  features: { realTimeConsumptionEnabled: boolean | null } | null
}

async function gql<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Tibber HTTP ${res.status}`)
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) throw new Error(`Tibber: ${body.errors.map((e) => e.message).join('; ')}`)
  if (!body.data) throw new Error('Tibber: empty response')
  return body.data
}

export async function tibberHomes(creds: TibberCredentials): Promise<TibberHome[]> {
  const data = await gql<{ viewer: { homes: TibberHome[] } }>(
    creds.token,
    `{ viewer { homes { id appNickname address { address1 } features { realTimeConsumptionEnabled } } } }`,
  )
  return data.viewer.homes
}

/** Today's and (after ~13:00) tomorrow's prices at 15-minute resolution */
export async function tibberPrices(creds: TibberCredentials, homeId: string): Promise<TibberPrice[]> {
  const data = await gql<{
    viewer: { home: { currentSubscription: { priceInfo: { today: TibberPrice[]; tomorrow: TibberPrice[] } } | null } }
  }>(
    creds.token,
    `query($homeId: ID!) { viewer { home(id: $homeId) { currentSubscription {
       priceInfo(resolution: QUARTER_HOURLY) {
         today { startsAt total energy tax }
         tomorrow { startsAt total energy tax }
       } } } } }`,
    { homeId },
  )
  const info = data.viewer.home.currentSubscription?.priceInfo
  if (!info) throw new Error('Tibber: home has no active subscription')
  return [...info.today, ...info.tomorrow]
}

export async function tibberWebsocketUrl(creds: TibberCredentials): Promise<string> {
  const data = await gql<{ viewer: { websocketSubscriptionUrl: string } }>(creds.token, `{ viewer { websocketSubscriptionUrl } }`)
  return data.viewer.websocketSubscriptionUrl
}

export const tibberUserAgent = UA
