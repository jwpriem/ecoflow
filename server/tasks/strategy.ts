import { runStrategy } from '../services/strategy'

export default defineTask({
  meta: { name: 'strategy', description: 'Rebuild the charge/discharge plan and steer the batteries' },
  async run() {
    return {
      result: await runJob('strategy', async (site) => {
        const r = await runStrategy(useDb(), site)
        return r.command
      }),
    }
  },
})
