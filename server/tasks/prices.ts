import { refreshPrices } from '../services/prices'
import { refreshIrradiance } from '../services/solarForecast'

export default defineTask({
  meta: { name: 'prices', description: 'Fetch Tibber prices for today and tomorrow, and the solar forecast' },
  async run() {
    return {
      result: await runJob('prices', async (site) => {
        const db = useDb()
        const prices = await refreshPrices(db, site, encryptionKey())
        // A missing forecast only makes the plan ignore the sun, so it never fails the price job
        const irradiance = await refreshIrradiance(db, site).catch((err: Error) => `error: ${err.message}`)
        return { prices, irradiance }
      }),
    }
  },
})
