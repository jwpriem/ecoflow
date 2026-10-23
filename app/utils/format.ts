import { ref } from 'vue'

/** Decimal comma for Dutch, point for English; useLocale keeps it in step with the language */
export const decimalComma = ref(true)
export const num = (v: number, digits = 2) => (decimalComma.value ? v.toFixed(digits).replace('.', ',') : v.toFixed(digits))

export const eur = (v: number | null | undefined, digits = 2) =>
  v == null ? '–' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)

export const kwh = (v: number | null | undefined, digits = 2) => (v == null ? '–' : `${num(v, digits)} kWh`)

export const watt = (v: number | null | undefined) => {
  if (v == null) return '–'
  return Math.abs(v) >= 1000 ? `${num(v / 1000)} kW` : `${Math.round(v)} W`
}

export const time = (d: string | Date) => new Date(d).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
