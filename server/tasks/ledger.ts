import { runLedger } from '../services/ledger'

export default defineTask({
  meta: { name: 'ledger', description: 'Book completed 15-min slots into the savings ledger' },
  async run() {
    return { result: await runJob('ledger', (site) => runLedger(useDb(), site)) }
  },
})
