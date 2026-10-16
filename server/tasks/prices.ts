import { refreshPrices } from '../services/prices'

export default defineTask({
  meta: { name: 'prices', description: 'Fetch Tibber prices for today and tomorrow' },
  async run() {
    return { result: await runJob('prices', (site) => refreshPrices(useDb(), site, encryptionKey())) }
  },
})
