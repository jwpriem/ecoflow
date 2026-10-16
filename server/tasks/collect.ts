import { collect } from '../services/collector'

export default defineTask({
  meta: { name: 'collect', description: 'Read batteries, grid and solar (every minute)' },
  async run() {
    return { result: await runJob('collect', (site) => collect(useDb(), site, encryptionKey())) }
  },
})
