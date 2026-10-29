import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { syncEcoFlowDevices } from '../services/ecoflow'
import { refreshPrices } from '../services/prices'
import { refreshIrradiance } from '../services/solarForecast'
import { syncPulse } from '../services/pulse'
import { experimentalSite } from '../services/experimental'
import { forEachSite, jobSites } from '../services/jobs'
import { runStrategy } from '../services/strategy'
import { readZeekrVehicles } from '../services/zeekr'

/** On boot: apply migrations, check the EcoFlow units, start the Tibber Pulse streams and make sure there are prices, a solar forecast and a plan. */
export default defineNitroPlugin(() => {
  // Prerendering the website at build time starts the server too: no database, no jobs then
  if (import.meta.prerender) return
  const cfg = useRuntimeConfig()
  if (!cfg.databaseUrl && !process.env.NUXT_DATABASE_URL) {
    console.warn('[startup] NUXT_DATABASE_URL not set, skipping migrations and jobs')
    return
  }
  void (async () => {
    const db = useDb()
    try {
      await migrate(db, { migrationsFolder: resolve(process.cwd(), 'server/db/migrations') })
      console.info('[startup] migrations applied')
    } catch (err) {
      console.error('[startup] migration failed', err)
      return
    }
    if (String(cfg.jobsEnabled) === 'false') return
    const key = cfg.encryptionKey || process.env.NUXT_ENCRYPTION_KEY || ''
    // Every instance starts its own Pulse streams, so no lock here. A household that hangs only holds up itself.
    const list = await jobSites(db, true)
    await forEachSite(
      list,
      async (site) => {
        const ef = await syncEcoFlowDevices(db, site, key)
        if (ef.error) console.error(`[startup] site ${site.id}: EcoFlow: ${ef.error}`)
        await syncPulse(db, site, key)
        await refreshPrices(db, site, key)
        await refreshIrradiance(db, site).catch((err: Error) => console.warn(`[startup] site ${site.id}: solar forecast: ${err.message}`))
        if (await experimentalSite(db, site.id)) {
          await readZeekrVehicles(db, site, key).catch((err: Error) => console.warn(`[startup] site ${site.id}: Zeekr: ${err.message}`))
        }
        await runStrategy(db, site)
      },
      { timeoutMs: 120_000, concurrency: Number(cfg.jobsConcurrency) || undefined },
      (site, err) => console.error(`[startup] site ${site.id}:`, err.message),
    )
    console.info(`[startup] ${list.length} households started`)
  })()
})
