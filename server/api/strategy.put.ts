import { eq } from 'drizzle-orm'
import { sites } from '../db/schema'
import { defaultStrategy, type StrategyConfig } from '../lib/types'
import { runStrategy } from '../services/strategy'

function num(v: unknown, min: number, max: number, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export default defineEventHandler(async (event) => {
  const { site } = await requireSite(event)
  const b = await readBody<Partial<StrategyConfig>>(event)
  const cur = { ...defaultStrategy, ...site.strategy }
  const next: StrategyConfig = {
    reserveSoc: num(b.reserveSoc, 0, 0.9, cur.reserveSoc),
    maxSoc: num(b.maxSoc, 0.5, 1, cur.maxSoc),
    roundTripEfficiency: num(b.roundTripEfficiency, 0.5, 1, cur.roundTripEfficiency),
    minSpread: num(b.minSpread, 0, 1, cur.minSpread),
    gridCharge: typeof b.gridCharge === 'boolean' ? b.gridCharge : cur.gridCharge,
    avgLoadW: num(b.avgLoadW, 50, 5000, cur.avgLoadW),
    fallbackPrice: num(b.fallbackPrice, 0, 2, cur.fallbackPrice),
    feedIn: {
      nettingUntil: typeof b.feedIn?.nettingUntil === 'string' && !Number.isNaN(Date.parse(b.feedIn.nettingUntil)) ? b.feedIn.nettingUntil : cur.feedIn.nettingUntil,
      factor: num(b.feedIn?.factor, 0, 2, cur.feedIn.factor),
      feeEur: num(b.feedIn?.feeEur, -1, 1, cur.feedIn.feeEur),
    },
  }
  const [updated] = await useDb().update(sites).set({ strategy: next }).where(eq(sites.id, site.id)).returning()
  await runStrategy(useDb(), updated!)
  return next
})
