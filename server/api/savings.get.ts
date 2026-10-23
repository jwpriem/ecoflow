import { savingsByPeriod, type Period } from '../services/ledger'
import { solarByPeriod } from '../services/solar'

const PERIODS: Period[] = ['hour', 'day', 'week', 'month', 'year']

function sum<T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[]) {
  const t = Object.fromEntries(keys.map((k) => [k, 0])) as Record<keyof T, number>
  for (const r of rows) for (const k of keys) t[k] += Number(r[k] ?? 0)
  return t
}

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const q = getQuery(event)
  const period = (PERIODS.includes(q.period as Period) ? q.period : 'day') as Period
  const to = q.to ? new Date(String(q.to)) : new Date()
  const defaultSpan = { hour: 2, day: 31, week: 120, month: 400, year: 3650 }[period] * 86_400_000
  const from = q.from ? new Date(String(q.from)) : new Date(to.getTime() - defaultSpan)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw createError({ statusCode: 400, statusMessage: 'Bad date' })

  const db = useDb()
  const rows = await savingsByPeriod(db, site, period, from, to)
  const solarRows = await solarByPeriod(db, site, period, from, to)
  const totals = sum(rows, ['chargedSolarKwh', 'chargedGridKwh', 'dischargedKwh', 'costNaive', 'costOpportunity', 'valueDischarged', 'savingNaive', 'savingOpportunity', 'lossKwh'])
  const solarTotals = sum(solarRows, ['producedKwh', 'selfUsedKwh', 'exportedKwh', 'toBatteryKwh', 'valueSelfUsed', 'valueExported', 'valueToBattery'])
  return { period, from, to, rows, totals, solar: { rows: solarRows, totals: solarTotals } }
})
