import { experimentalSite } from '../services/experimental'
import { readZeekrVehicles } from '../services/zeekr'

export default defineTask({
  meta: { name: 'vehicles', description: 'Read the Zeekr cars (every 5 minutes)' },
  async run() {
    // Reading the cars also drives Tibber's EV charging and the plug-in push: all of it only for experimental households
    return {
      result: await runJob('vehicles', async (site) =>
        (await experimentalSite(useDb(), site.id)) ? readZeekrVehicles(useDb(), site, encryptionKey()) : { skipped: 'not experimental' },
      ),
    }
  },
})
