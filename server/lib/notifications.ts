import type { PlanSlot } from './strategy'
import { addMs, SLOT_MS, slotStartOf } from './time'
import type { BatteryMode, PriceSlot } from './types'

/** Texts for push notifications. Pure functions so they can be tested without a database. */

const eur = (v: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(v)
const hhmm = (d: Date, timeZone: string) => d.toLocaleTimeString('nl-NL', { timeZone, hour: '2-digit', minute: '2-digit' })

const PROVIDER_NAME: Record<string, string> = {
  tibber: 'Tibber',
  solaredge: 'SolarEdge',
  ecoflow_official: 'EcoFlow developer API',
}

/** Only grid charging and discharging are worth a notification; the other modes are the quiet default. */
export function planChangeMessage(plan: PlanSlot[], now: Date, prevMode: BatteryMode | undefined, timeZone: string) {
  const i = plan.findIndex((p) => p.slotStart.getTime() === slotStartOf(now).getTime())
  const slot = plan[i]
  if (!slot || slot.action === prevMode || (slot.action !== 'charge_grid' && slot.action !== 'discharge')) return null
  let end = i
  while (plan[end + 1]?.action === slot.action) end++
  const until = hhmm(addMs(plan[end]!.slotStart, SLOT_MS), timeZone)
  const avg = plan.slice(i, end + 1).reduce((s, p) => s + p.price, 0) / (end - i + 1)
  return slot.action === 'charge_grid'
    ? { title: 'Charging from the grid', body: `Cheap power at ${eur(avg)}/kWh until ${until}.`, url: '/plan', tag: 'plan' }
    : { title: 'Batteries are discharging', body: `Power costs ${eur(avg)}/kWh until ${until}, using stored energy instead.`, url: '/plan', tag: 'plan' }
}

/** Summary of a day's prices: cheapest and most expensive hour. */
export function pricesMessage(slots: PriceSlot[], timeZone: string) {
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
  return {
    title: "Tomorrow's prices are in",
    body: `Cheapest ${hhmm(min.start, timeZone)} at ${eur(min.price)}, most expensive ${hhmm(max.start, timeZone)} at ${eur(max.price)}.`,
    url: '/plan',
    tag: 'prices',
  }
}

export function integrationErrorMessage(provider: string, error: string) {
  const name = PROVIDER_NAME[provider] ?? provider
  return { title: `${name} connection problem`, body: error.slice(0, 180), url: '/settings', tag: `error-${provider}` }
}

export function dailyMessage(t: { savingNaive: number; dischargedKwh: number; chargedSolarKwh: number; chargedGridKwh: number }) {
  const parts = [`${t.dischargedKwh.toFixed(1)} kWh used from the batteries`]
  if (t.chargedSolarKwh >= 0.05) parts.push(`${t.chargedSolarKwh.toFixed(1)} kWh solar stored`)
  if (t.chargedGridKwh >= 0.05) parts.push(`${t.chargedGridKwh.toFixed(1)} kWh bought cheap`)
  return { title: `Saved ${eur(t.savingNaive)} today`, body: `${parts.join(', ')}.`, url: '/savings', tag: 'daily' }
}
