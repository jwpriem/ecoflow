import { dailyMessage } from '../lib/notifications'
import { localHour, startOfLocalDay } from '../lib/time'
import { savingsByPeriod } from '../services/ledger'
import { notify } from '../services/push'

/** Daily savings summary, sent at 21:00 local time to devices that subscribed to `daily`. */
export default defineTask({
  meta: { name: 'digest', description: "Push today's savings at 21:00" },
  async run() {
    return {
      result: await runJob('digest', async (site) => {
        const now = new Date()
        if (Math.floor(localHour(now, site.timezone)) !== 21) return { skipped: 'not 21:00' }
        const db = useDb()
        const [today] = await savingsByPeriod(db, site, 'day', startOfLocalDay(now, site.timezone), now)
        if (!today) return { skipped: 'no ledger rows today' }
        return notify(db, site.id, 'daily', dailyMessage(today))
      }),
    }
  },
})
