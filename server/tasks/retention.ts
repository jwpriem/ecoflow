import { refreshTypicalLoad } from '../services/load'
import { thinSamples } from '../services/retention'

export default defineTask({
  meta: { name: 'retention', description: 'Nightly: thin minute samples older than 60 days, work out the typical load' },
  async run() {
    return {
      result: await runJob('retention', async (site) => {
        const thinned = await thinSamples(useDb(), site)
        // The typical load from the last 14 days, for households that have it on auto
        return { thinned, avgLoadW: await refreshTypicalLoad(useDb(), site) }
      }),
    }
  },
})
