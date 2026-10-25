import { readZeekrVehicles } from '../services/zeekr'

export default defineTask({
  meta: { name: 'vehicles', description: 'Read the Zeekr cars (every 5 minutes)' },
  async run() {
    return { result: await runJob('vehicles', (site) => readZeekrVehicles(useDb(), site, encryptionKey())) }
  },
})
