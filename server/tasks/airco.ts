import { experimentalSite } from '../services/experimental'
import { recordAircos } from '../services/midea'

export default defineTask({
  meta: { name: 'airco', description: 'Read the Midea air conditioners for the temperature chart (every 5 minutes)' },
  async run() {
    return {
      result: await runJob('airco', async (site) =>
        (await experimentalSite(useDb(), site.id)) ? recordAircos(useDb(), site, encryptionKey()) : { skipped: 'not experimental' },
      ),
    }
  },
})
