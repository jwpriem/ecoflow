export const SLOT_MS = 15 * 60 * 1000

export function slotStartOf(d: Date | number): Date {
  const t = typeof d === 'number' ? d : d.getTime()
  return new Date(Math.floor(t / SLOT_MS) * SLOT_MS)
}

export function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms)
}

/** Local wall-clock hour (0-23, fractional) of a date in a timezone */
export function localHour(d: Date, timeZone = 'Europe/Amsterdam'): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h + m / 60
}

/** Offset of a timezone from UTC at a moment, in ms (e.g. +2h in Amsterdam summer) */
export function tzOffsetMs(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(d.getTime() / 1000) * 1000
}

/** Local midnight (as a UTC instant) of the day containing d */
export function startOfLocalDay(d: Date, timeZone: string): Date {
  const local = new Date(d.getTime() + tzOffsetMs(d, timeZone))
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  return new Date(midnight - tzOffsetMs(new Date(midnight - tzOffsetMs(d, timeZone)), timeZone))
}
