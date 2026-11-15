import { refreshTypicalLoad } from '../services/load'
import { purgeExpired, thinSamples } from '../services/retention'

export default defineTask({
  meta: { name: 'retention', description: 'Nightly: purge expired records, thin minute samples older than 60 days, work out the typical load' },
  async run() {
    // Expired sessions, used links, old job runs, old commands and car readings: once for everyone
    const purged = await purgeExpired(useDb()).catch((err: Error) => {
      console.error('[retention] purge failed:', err.message)
      return null
    })
    if (purged) console.info(`[retention] purged ${JSON.stringify(purged)}`)
    return {
      result: await runJob('retention', async (site) => {
        const thinned = await thinSamples(useDb(), site)
        // The typical load from the last 14 days, for households that have it on auto
        return { thinned, avgLoadW: await refreshTypicalLoad(useDb(), site) }
      }),
    }
  },
})
