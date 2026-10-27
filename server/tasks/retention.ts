import { thinSamples } from '../services/retention'

export default defineTask({
  meta: { name: 'retention', description: 'Thin minute samples older than 60 days to 15-min averages' },
  async run() {
    return { result: await runJob('retention', (site) => thinSamples(useDb(), site)) }
  },
})
