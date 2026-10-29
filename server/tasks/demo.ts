import { demoTick } from '../services/demoData'

export default defineTask({
  meta: { name: 'demo', description: 'Write the demo household readings, prices and plan (every 5 minutes)' },
  async run() {
    return { result: await runJob('demo', (site) => demoTick(useDb(), site)) }
  },
})
