/**
 * Calendar periods for the Savings tab: a week (Monday to Sunday), a month or a year, in local time.
 * The server buckets savings per day or per month in the site's time zone and labels them 'YYYY-MM-DDTHH:MM'.
 */
export type Span = 'week' | 'month' | 'year'

export interface Range {
  span: Span
  /** First moment of the period, local midnight */
  start: Date
  /** First moment after the period */
  end: Date
}

export const SPANS: readonly Span[] = ['week', 'month', 'year']

/** The period of this span that contains the given moment */
export function rangeOf(span: Span, at: Date): Range {
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate())
  if (span === 'week') {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
    return { span, start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) }
  }
  if (span === 'month') return { span, start: new Date(d.getFullYear(), d.getMonth(), 1), end: new Date(d.getFullYear(), d.getMonth() + 1, 1) }
  return { span, start: new Date(d.getFullYear(), 0, 1), end: new Date(d.getFullYear() + 1, 0, 1) }
}

/** The period n steps before (negative) or after (positive) this one */
export function shiftRange(r: Range, n: number): Range {
  const s = r.start
  if (r.span === 'week') return rangeOf('week', new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 * n))
  if (r.span === 'month') return rangeOf('month', new Date(s.getFullYear(), s.getMonth() + n, 1))
  return rangeOf('year', new Date(s.getFullYear() + n, 0, 1))
}

/** What the server groups by: days for a week or month, months for a year */
export const bucketOf = (span: Span) => (span === 'year' ? 'month' : 'day') as 'day' | 'month'

const pad = (n: number) => String(n).padStart(2, '0')
/** The server's label for the bucket that starts at this local moment */
export const bucketKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`

/** Every bucket in the period, also the ones still to come */
export function slotsOf(r: Range): Date[] {
  const out: Date[] = []
  for (let d = new Date(r.start); d < r.end; ) {
    out.push(d)
    d = r.span === 'year' ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  }
  return out
}

export const rangeIsCurrent = (r: Range, now: Date) => now >= r.start && now < r.end

/** How much of the period has passed, 0 to 1 */
export function elapsedShare(r: Range, now: Date) {
  const t = Math.min(Math.max(now.getTime(), r.start.getTime()), r.end.getTime())
  return (t - r.start.getTime()) / (r.end.getTime() - r.start.getTime())
}

/**
 * What to compare with: the period before. While a period is still running, only the same stretch of the
 * period before (1–6 October against 1–6 November), so a half month is not held against a whole one.
 */
export function comparisonOf(r: Range, now: Date): { from: Date; to: Date; partial: boolean } {
  const prev = shiftRange(r, -1)
  if (!rangeIsCurrent(r, now)) return { from: prev.start, to: prev.end, partial: false }
  const to = new Date(Math.min(prev.start.getTime() + (now.getTime() - r.start.getTime()), prev.end.getTime()))
  return { from: prev.start, to, partial: true }
}

/** ISO 8601 week number */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7)
}

/** A projection for the whole period, once enough of it has passed to say something */
export function projectTotal(total: number, r: Range, now: Date): number | null {
  if (!rangeIsCurrent(r, now)) return null
  const share = elapsedShare(r, now)
  return share >= 0.15 ? total / share : null
}
