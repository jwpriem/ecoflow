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
  zeekr: { en: 'Zeekr', nl: 'Zeekr' },
  tibber_app: { en: 'Tibber app (charging)', nl: 'Tibber-app (laden)' },
  hue: { en: 'Philips Hue', nl: 'Philips Hue' },
  nest: { en: 'Google Nest', nl: 'Google Nest' },
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

/** A car was just plugged in at home: tap to set when it has to leave, for Tibber's smart charging. */
export function departureAskMessage(carName: string, carId: number): LocalizedPush {
  return (l) =>
    l === 'nl'
      ? { title: `${carName} is aangesloten`, body: 'Wanneer moet je weer weg? Tik om de vertrektijd in Tibber te zetten.', url: `/cars?departure=${carId}`, tag: `departure-${carId}` }
      : { title: `${carName} is plugged in`, body: 'When do you need to leave? Tap to set the departure time in Tibber.', url: `/cars?departure=${carId}`, tag: `departure-${carId}` }
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
  l === 'nl' ? { title: 'WattsWise', body: 'Meldingen werken 🎉', url: '/settings', tag: 'test' } : { title: 'WattsWise', body: 'Notifications work 🎉', url: '/settings', tag: 'test' }

const when = (d: Date, now: Date, timeZone: string, l: Locale) => {
  const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone })
  const time = hhmm(d, timeZone)
  if (day(d) === day(now)) return time
  const date = d.toLocaleDateString(l === 'nl' ? 'nl-NL' : 'en-GB', { timeZone, day: 'numeric', month: 'short' })
  return l === 'nl' ? `${date} ${time}` : `${date}, ${time}`
}

const duration = (ms: number, l: Locale) => {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return l === 'nl' ? `${min} min` : `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return l === 'nl' ? `${h} uur` : `${h} ${h === 1 ? 'hour' : 'hours'}`
  const d = Math.round(h / 24)
  return l === 'nl' ? `${d} dagen` : `${d} days`
}

/** The Tibber Pulse sent nothing for a while: the house load and solar surplus are blind until it's back */
export function pulseDownMessage(since: Date, now: Date, timeZone: string): LocalizedPush {
  return (l) =>
    l === 'nl'
      ? {
          title: 'Tibber Pulse geeft geen data',
          body: `Sinds ${when(since, now, timeZone, l)} komen er geen meterstanden binnen. Kijk of de Pulse nog brandt of haal hem even uit de meter. Je krijgt bericht als hij terug is.`,
          url: '/settings',
          tag: 'pulse',
        }
      : {
          title: 'Tibber Pulse sends no data',
          body: `No meter readings since ${when(since, now, timeZone, l)}. Check whether the Pulse is lit, or unplug it from the meter for a moment. You'll hear when it's back.`,
          url: '/settings',
          tag: 'pulse',
        }
}

export function pulseUpMessage(downForMs: number): LocalizedPush {
  return (l) =>
    l === 'nl'
      ? { title: 'Tibber Pulse is terug', body: `Na ${duration(downForMs, l)} zonder data komen de meterstanden weer binnen.`, url: '/', tag: 'pulse' }
      : { title: 'Tibber Pulse is back', body: `Meter readings are coming in again after ${duration(downForMs, l)} without data.`, url: '/', tag: 'pulse' }
}

/**
 * Someone at the door, a person or motion at a camera. Tapping opens the Security tab with that camera live.
 * A ring gets its own tag, so it always sounds; motion and a person replace each other per camera.
 */
export function nestEventMessage(kind: 'chime' | 'person' | 'motion', camera: { id: string; name: string }, at: Date, timeZone: string): LocalizedPush {
  const time = hhmm(at, timeZone)
  const url = `/security?live=${encodeURIComponent(camera.id)}`
  const text = {
    chime: { nl: { title: 'Er wordt aangebeld', body: `${camera.name}, ${time}. Tik voor live beeld.` }, en: { title: 'Someone’s at the door', body: `${camera.name}, ${time}. Tap to watch live.` } },
    person: { nl: { title: `Persoon bij ${camera.name}`, body: `Gezien om ${time}. Tik voor live beeld.` }, en: { title: `Person at ${camera.name}`, body: `Seen at ${time}. Tap to watch live.` } },
    motion: { nl: { title: `Beweging bij ${camera.name}`, body: `Om ${time}. Tik voor live beeld.` }, en: { title: `Motion at ${camera.name}`, body: `At ${time}. Tap to watch live.` } },
  }[kind]
  const tag = kind === 'chime' ? `nest-ring-${camera.id}-${at.getTime()}` : `nest-${camera.id}`
  return (l) => ({ ...text[l], url, tag })
}
