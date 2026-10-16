/**
 * Creates (or resets) the seed account with two simulated STREAM Pro batteries and SEED_DAYS of
 * fake history: prices, household load, solar, battery behaviour driven by the real strategy code,
 * and the resulting savings ledger.
 *
 *   npm run db:seed
 */
import { eq, inArray } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http'
import { migrate as migrateNeonHttp } from 'drizzle-orm/neon-http/migrator'
import { createDb, schema, type Db } from '../server/db/client'
import { batteryPool, commandsLog, devices, ledger, plans, prices, samples, sites, users } from '../server/db/schema'
import { fakeLoadW, fakeSolarW } from '../server/lib/fake'
import { simulateStep, type SimState } from '../server/lib/simulator'
import { buildPlan } from '../server/lib/strategy'
import { addMs, SLOT_MS, slotStartOf, startOfLocalDay } from '../server/lib/time'
import { runLedger } from '../server/services/ledger'
import { fakePriceRows, upsertPrices } from '../server/services/prices'
import { createAccount } from '../server/services/setup'

const email = (process.env.SEED_EMAIL ?? 'me@example.com').toLowerCase()
const password = process.env.SEED_PASSWORD ?? 'change-me-please'
const days = Number(process.env.SEED_DAYS ?? 30)

const url = process.env.NUXT_DATABASE_URL ?? ''
// SEED_NEON_HTTP=1 talks to Neon over HTTPS instead of the Postgres port (for networks that only allow HTTPS)
const overHttp = process.env.SEED_NEON_HTTP === '1'
const httpDb = overHttp ? drizzleNeonHttp(neon(url), { schema }) : undefined
const db = (httpDb ?? createDb(url)) as unknown as Db
if (httpDb) await migrateNeonHttp(httpDb, { migrationsFolder: 'server/db/migrations' })
else await migrate(db, { migrationsFolder: 'server/db/migrations' })
// Smaller batches over HTTP to keep request bodies small
const batchSize = overHttp ? 2000 : 5000

let [user] = await db.select().from(users).where(eq(users.email, email))
let site: typeof sites.$inferSelect
if (!user) {
  const created = await createAccount(db, email, password)
  user = created.user
  site = created.site
  console.log(`created ${email} / ${password}`)
} else {
  ;[site] = (await db.select().from(sites).where(eq(sites.userId, user.id))) as [typeof sites.$inferSelect]
  const devIds = (await db.select({ id: devices.id }).from(devices).where(eq(devices.siteId, site.id))).map((d) => d.id)
  if (devIds.length) {
    await db.delete(batteryPool).where(inArray(batteryPool.deviceId, devIds))
    await db.delete(commandsLog).where(inArray(commandsLog.deviceId, devIds))
  }
  await db.delete(ledger).where(eq(ledger.siteId, site.id))
  await db.delete(samples).where(eq(samples.siteId, site.id))
  await db.delete(plans).where(eq(plans.siteId, site.id))
  await db.delete(prices).where(eq(prices.siteId, site.id))
  console.log(`reset history for ${email}`)
}

const devs = await db.select().from(devices).where(eq(devices.siteId, site.id))
const tz = site.timezone
const cfg = site.strategy
const now = new Date()
const start = startOfLocalDay(addMs(now, -days * 86_400_000), tz)
const end = new Date(Math.floor(now.getTime() / 60_000) * 60_000)

// Prices for the whole history plus tomorrow
const priceRows = fakePriceRows(site, start, addMs(startOfLocalDay(now, tz), 48 * 3600_000))
await upsertPrices(db, priceRows)
const priceAt = new Map(priceRows.map((p) => [p.slotStart.getTime(), p]))
console.log(`prices: ${priceRows.length} slots`)

let states: SimState[] = devs.map(() => ({ soc: 0.3, mode: 'self_use', powerW: 0, pvW: 0, ts: start.toISOString() }))
const limits = { reserveSoc: cfg.reserveSoc, maxSoc: cfg.maxSoc, legEfficiency: Math.sqrt(cfg.roundTripEfficiency) }
const capacityKwh = devs.reduce((s, d) => s + d.capacityWh, 0) / 1000
let plan = new Map<number, { action: SimState['mode']; targetW?: number }>()
let buffer: (typeof samples.$inferInsert)[] = []
const flush = async () => {
  for (let i = 0; i < buffer.length; i += batchSize) await db.insert(samples).values(buffer.slice(i, i + batchSize))
  buffer = []
}

for (let t = start; t < end; t = addMs(t, 60_000)) {
  // Re-plan every hour with what would have been known then (tomorrow's prices only after 13:00)
  if (t.getTime() % 3600_000 === 0) {
    const dayStart = startOfLocalDay(t, tz)
    const known = addMs(dayStart, (t.getTime() - dayStart.getTime() >= 13 * 3600_000 ? 48 : 24) * 3600_000)
    const horizon = []
    for (let s = slotStartOf(t); s < known; s = addMs(s, SLOT_MS)) {
      const p = priceAt.get(s.getTime())
      if (p) horizon.push({ slotStart: s, total: p.total, energy: p.energy, feedIn: p.feedIn })
    }
    const stored = states.reduce((s, st, i) => s + (st.soc * devs[i]!.capacityWh) / 1000, 0)
    const result = buildPlan({
      prices: horizon,
      storedKwh: stored,
      capacityKwh,
      maxChargeW: devs.reduce((s, d) => s + d.maxChargeW, 0),
      maxDischargeW: devs.reduce((s, d) => s + d.maxDischargeW, 0),
      poolAvgCost: 0.12,
      cfg,
    })
    plan = new Map(result.map((r) => [r.slotStart.getTime(), { action: r.action, targetW: r.targetW }]))
  }
  const slot = plan.get(slotStartOf(t).getTime())
  states = states.map((s) => ({
    ...s,
    mode: slot?.action ?? 'self_use',
    commandW: slot?.targetW ? Math.round(slot.targetW / devs.length) : undefined,
  }))
  const load = fakeLoadW(t, tz)
  const solar = fakeSolarW(t, tz)
  const houseNet = load - solar
  states = simulateStep(devs.map((d, i) => ({ device: d, state: states[i]! })), houseNet, 60, limits, t)
  const batteryW = states.reduce((s, st) => s + st.powerW, 0)
  devs.forEach((d, i) => buffer.push({ siteId: site.id, deviceId: d.id, ts: t, kind: 'battery', powerW: states[i]!.powerW, soc: states[i]!.soc, pvW: 0 }))
  buffer.push({ siteId: site.id, ts: t, kind: 'grid', powerW: houseNet + batteryW })
  buffer.push({ siteId: site.id, ts: t, kind: 'solar', powerW: solar })
  if (buffer.length >= 20000) await flush()
}
await flush()
for (const [i, d] of devs.entries()) {
  await db.update(devices).set({ state: states[i] as unknown as Record<string, unknown> }).where(eq(devices.id, d.id))
}
console.log(`samples: ${days} days simulated`)

const booked = await runLedger(db, site, now)
console.log(`ledger: ${booked} slot rows booked`)
console.log(`\nLog in with ${email}`)
process.exit(0)
