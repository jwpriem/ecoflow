export const eur = (v: number | null | undefined, digits = 2) =>
  v == null ? '–' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)

export const kwh = (v: number | null | undefined, digits = 2) => (v == null ? '–' : `${v.toFixed(digits)} kWh`)

export const watt = (v: number | null | undefined) => {
  if (v == null) return '–'
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${Math.round(v)} W`
}

export const time = (d: string | Date) => new Date(d).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })

export const MODE_LABEL: Record<string, string> = {
  self_use: 'Self-use',
  solar_only: 'Hold',
  charge_grid: 'Charge from grid',
  discharge: 'Discharge',
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
