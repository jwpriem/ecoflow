import type { PlanSlot } from './strategy'
import { addMs, SLOT_MS, slotStartOf } from './time'
import type { BatteryMode, Locale, PriceSlot } from './types'

/**
 * Texts for push notifications. Pure functions so they can be tested without a database.
 * Each returns the message per language: every device gets it in the language it was set to.
 */
export interface PushText {
  title: string
  body: string
  url?: string
  tag?: string
}
export type LocalizedPush = (locale: Locale) => PushText

const eur = (v: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(v)
const hhmm = (d: Date, timeZone: string) => d.toLocaleTimeString('nl-NL', { timeZone, hour: '2-digit', minute: '2-digit' })

const PROVIDER_NAME: Record<string, Record<Locale, string>> = {
  tibber: { en: 'Tibber', nl: 'Tibber' },
  solaredge: { en: 'SolarEdge', nl: 'SolarEdge' },
  ecoflow_official: { en: 'EcoFlow developer API', nl: 'EcoFlow-ontwikkelaars-API' },
}

/** Only grid charging and discharging are worth a notification; the other modes are the quiet default. */
export function planChangeMessage(plan: PlanSlot[], now: Date, prevMode: BatteryMode | undefined, timeZone: string): LocalizedPush | null {
  const i = plan.findIndex((p) => p.slotStart.getTime() === slotStartOf(now).getTime())
  const slot = plan[i]
  if (!slot || slot.action === prevMode || (slot.action !== 'charge_grid' && slot.action !== 'discharge')) return null
  let end = i
  while (plan[end + 1]?.action === slot.action) end++
  const until = hhmm(addMs(plan[end]!.slotStart, SLOT_MS), timeZone)
  const avg = plan.slice(i, end + 1).reduce((s, p) => s + p.price, 0) / (end - i + 1)
  const text = {
    charge_grid: {
      en: { title: 'Charging from the grid', body: `Cheap power at ${eur(avg)}/kWh until ${until}.` },
      nl: { title: 'Laden van het net', body: `Goedkope stroom voor ${eur(avg)}/kWh tot ${until}.` },
    },
    discharge: {
      en: { title: 'Batteries are discharging', body: `Power costs ${eur(avg)}/kWh until ${until}, using stored energy instead.` },
      nl: { title: 'Batterijen ontladen', body: `Stroom kost ${eur(avg)}/kWh tot ${until}, daarom gebruiken we de opgeslagen energie.` },
    },
  }[slot.action]
  return (l) => ({ ...text[l], url: '/plan', tag: 'plan' })
}

/** Summary of a day's prices: cheapest and most expensive hour. */
export function pricesMessage(slots: PriceSlot[], timeZone: string): LocalizedPush | null {
  if (!slots.length) return null
  const hours = new Map<number, { start: Date; sum: number; n: number }>()
  for (const s of slots) {
    const key = Math.floor(s.slotStart.getTime() / 3600_000)
    const h = hours.get(key) ?? { start: s.slotStart, sum: 0, n: 0 }
    h.sum += s.total
    h.n++
    hours.set(key, h)
  }
  const avg = [...hours.values()].map((h) => ({ start: h.start, price: h.sum / h.n }))
  const min = avg.reduce((a, b) => (b.price < a.price ? b : a))
  const max = avg.reduce((a, b) => (b.price > a.price ? b : a))
  const lo = hhmm(min.start, timeZone)
  const hi = hhmm(max.start, timeZone)
  const text = {
    en: { title: "Tomorrow's prices are in", body: `Cheapest ${lo} at ${eur(min.price)}, most expensive ${hi} at ${eur(max.price)}.` },
    nl: { title: 'De prijzen van morgen zijn er', body: `Goedkoopst ${lo} voor ${eur(min.price)}, duurst ${hi} voor ${eur(max.price)}.` },
  }
  return (l) => ({ ...text[l], url: '/plan', tag: 'prices' })
}

export function integrationErrorMessage(provider: string, error: string): LocalizedPush {
  return (l) => {
    const name = PROVIDER_NAME[provider]?.[l] ?? provider
    // The error itself comes from the provider and stays as it is
    return { title: l === 'nl' ? `Verbindingsprobleem met ${name}` : `${name} connection problem`, body: error.slice(0, 180), url: '/settings', tag: `error-${provider}` }
  }
}

export function dailyMessage(t: { savingNaive: number; dischargedKwh: number; chargedSolarKwh: number; chargedGridKwh: number }): LocalizedPush {
  return (l) => {
    const n = (v: number) => (l === 'nl' ? v.toFixed(1).replace('.', ',') : v.toFixed(1))
    const parts = [l === 'nl' ? `${n(t.dischargedKwh)} kWh uit de batterijen gebruikt` : `${n(t.dischargedKwh)} kWh used from the batteries`]
    if (t.chargedSolarKwh >= 0.05) parts.push(l === 'nl' ? `${n(t.chargedSolarKwh)} kWh zonne-energie opgeslagen` : `${n(t.chargedSolarKwh)} kWh solar stored`)
    if (t.chargedGridKwh >= 0.05) parts.push(l === 'nl' ? `${n(t.chargedGridKwh)} kWh goedkoop ingekocht` : `${n(t.chargedGridKwh)} kWh bought cheap`)
    const title = l === 'nl' ? `Vandaag ${eur(t.savingNaive)} bespaard` : `Saved ${eur(t.savingNaive)} today`
    return { title, body: `${parts.join(', ')}.`, url: '/savings', tag: 'daily' }
  }
}

/** Sent from Settings to check that notifications reach this device */
export const testMessage: LocalizedPush = (l) =>
  l === 'nl' ? { title: 'WattWise', body: 'Meldingen werken 🎉', url: '/settings', tag: 'test' } : { title: 'WattWise', body: 'Notifications work 🎉', url: '/settings', tag: 'test' }
