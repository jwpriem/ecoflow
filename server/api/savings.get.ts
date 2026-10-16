import { savingsByPeriod, type Period } from '../services/ledger'

const PERIODS: Period[] = ['hour', 'day', 'week', 'month', 'year']

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const q = getQuery(event)
  const period = (PERIODS.includes(q.period as Period) ? q.period : 'day') as Period
  const to = q.to ? new Date(String(q.to)) : new Date()
  const defaultSpan = { hour: 2, day: 31, week: 120, month: 400, year: 3650 }[period] * 86_400_000
  const from = q.from ? new Date(String(q.from)) : new Date(to.getTime() - defaultSpan)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw createError({ statusCode: 400, statusMessage: 'Bad date' })

  const rows = await savingsByPeriod(useDb(), site, period, from, to)
  const totals = rows.reduce(
    (t, r) => {
      for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += r[k] ?? 0
      return t
    },
    { chargedSolarKwh: 0, chargedGridKwh: 0, dischargedKwh: 0, costNaive: 0, costOpportunity: 0, valueDischarged: 0, savingNaive: 0, savingOpportunity: 0, lossKwh: 0 },
  )
  return { period, from, to, rows, totals }
})
