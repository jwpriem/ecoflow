import { runLedger } from '../services/ledger'
import { runSolarLedger } from '../services/solar'

export default defineTask({
  meta: { name: 'ledger', description: 'Book completed 15-min slots into the battery and solar ledgers' },
  async run() {
    return {
      result: await runJob('ledger', async (site) => {
        const db = useDb()
        // Solar second: it uses the solar the batteries took in, as the battery ledger just booked it
        const battery = await runLedger(db, site)
        return { battery, solar: await runSolarLedger(db, site) }
      }),
    }
  },
})
