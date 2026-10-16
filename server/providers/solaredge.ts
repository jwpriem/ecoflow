/** SolarEdge monitoring API. Limit: 300 requests per day per site, so callers must cache. */
const API = 'https://monitoringapi.solaredge.com'

export interface SolarEdgeCredentials {
  apiKey: string
  siteId: string
}

export interface PowerFlow {
  pvW: number
  loadW: number
  /** + import, - export */
  gridW: number
}

async function get<T>(creds: SolarEdgeCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, api_key: creds.apiKey })
  const res = await fetch(`${API}/site/${encodeURIComponent(creds.siteId)}${path}?${qs}`)
  if (!res.ok) throw new Error(`SolarEdge HTTP ${res.status}`)
  return (await res.json()) as T
}

export async function solarEdgeOverview(creds: SolarEdgeCredentials) {
  const data = await get<{ overview: { currentPower: { power: number }; lastDayData: { energy: number }; lastUpdateTime: string } }>(
    creds,
    '/overview',
  )
  return {
    currentPowerW: data.overview.currentPower.power,
    todayWh: data.overview.lastDayData.energy,
    lastUpdateTime: data.overview.lastUpdateTime,
  }
}

export async function solarEdgePowerFlow(creds: SolarEdgeCredentials): Promise<PowerFlow> {
  const data = await get<{
    siteCurrentPowerFlow: {
      unit: string
      GRID?: { currentPower: number }
      LOAD?: { currentPower: number }
      PV?: { currentPower: number }
      connections?: { from: string; to: string }[]
    }
  }>(creds, '/currentPowerFlow')
  const f = data.siteCurrentPowerFlow
  const mult = f.unit === 'W' ? 1 : 1000
  const pvW = (f.PV?.currentPower ?? 0) * mult
  const loadW = (f.LOAD?.currentPower ?? 0) * mult
  const gridAbs = (f.GRID?.currentPower ?? 0) * mult
  const exporting = f.connections?.some((c) => c.to.toUpperCase() === 'GRID') ?? false
  return { pvW, loadW, gridW: exporting ? -gridAbs : gridAbs }
}
