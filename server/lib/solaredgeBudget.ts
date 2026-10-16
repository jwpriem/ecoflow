/**
 * Credit budget for the SolarEdge Monitoring API v2 Free tier: 2,000 credits a month, one credit per call.
 * We don't know when the billing cycle starts, so the guarantee is a daily cap that keeps any 31 days
 * under the monthly limit. The polling schedule itself stays below that cap; the cap is the safety net.
 */
import { localHour, tzOffsetMs } from './time'

export const SE_MONTHLY_CREDITS = 2000
/** floor(2000 / 31) = 64, so any 31-day billing cycle stays at or under 1,984 credits */
export const SE_DAILY_CREDIT_CAP = Math.floor(SE_MONTHLY_CREDITS / 31)
/** /power has 15-minute buckets; one read every 20 minutes */
export const SE_POLL_MS = 20 * 60_000
/** Local hours [start, end) with daylight in the Netherlands all year (sunrise 05:20, sunset 22:00 at the extremes) */
export const SE_WINDOW = { startHour: 5, endHour: 22 }
/** Refresh the access token (2 h lifetime) this long before it expires */
export const SE_TOKEN_MARGIN_MS = 5 * 60_000

export function sePollSlot(now: Date): number {
  return Math.floor(now.getTime() / SE_POLL_MS)
}

export function seInWindow(now: Date, timeZone: string): boolean {
  const h = localHour(now, timeZone)
  return h >= SE_WINDOW.startHour && h < SE_WINDOW.endHour
}

export function seTokenNeedsRefresh(expiresAt: number | undefined, now: Date): boolean {
  return !expiresAt || expiresAt - SE_TOKEN_MARGIN_MS <= now.getTime()
}

/** Site-local wall-clock time without an offset (2026-05-01T00:00:00), used for the ledger's day and month */
export function seLocalIso(d: Date, timeZone: string): string {
  return new Date(d.getTime() + tzOffsetMs(d, timeZone)).toISOString().slice(0, 19)
}

/** UTC instant to the second (2026-05-01T10:15:00Z): the v2 API parses from/to as a Java Instant */
export function seInstant(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export interface CreditLedger {
  /** Local date, YYYY-MM-DD */
  day: string
  dayUsed: number
  /** Local calendar month, YYYY-MM (the billing cycle may start on another day) */
  month: string
  monthUsed: number
}

function keys(now: Date, timeZone: string) {
  const day = seLocalIso(now, timeZone).slice(0, 10)
  return { day, month: day.slice(0, 7) }
}

export function creditsLeftToday(ledger: CreditLedger | undefined, now: Date, timeZone: string): number {
  const used = ledger && ledger.day === keys(now, timeZone).day ? ledger.dayUsed : 0
  return SE_DAILY_CREDIT_CAP - used
}

export function addCredits(ledger: CreditLedger | undefined, now: Date, timeZone: string, n = 1): CreditLedger {
  const { day, month } = keys(now, timeZone)
  return {
    day,
    dayUsed: (ledger?.day === day ? ledger.dayUsed : 0) + n,
    month,
    monthUsed: (ledger?.month === month ? ledger.monthUsed : 0) + n,
  }
}
