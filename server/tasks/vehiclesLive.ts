import { experimentalSite } from '../services/experimental'
import { readZeekrVehicles } from '../services/zeekr'

export default defineTask({
  meta: { name: 'vehiclesLive', description: 'Read the cars linked to ABRP every minute while they drive' },
  async run() {
    // Every fifth minute the full read (the vehicles job) does it, ABRP included
    if (new Date().getUTCMinutes() % 5 === 0) return { result: { skipped: 'full read this minute' } }
    return {
      result: await runJob('vehiclesLive', async (site) =>
        (await experimentalSite(useDb(), site.id)) ? readZeekrVehicles(useDb(), site, encryptionKey(), new Date(), { live: true }) : { skipped: 'not experimental' },
      ),
    }
  },
})
