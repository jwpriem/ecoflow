import { experimentalSite } from '../services/experimental'
import { getIntegration } from '../services/integrations'
import { startMorning } from '../services/sonos'

/** Morning music on Sonos: at the owner's set time, play a favorite or playlist on the chosen speakers together. */
export default defineTask({
  meta: { name: 'morning', description: 'Start the morning music on Sonos at its set time' },
  async run() {
    return {
      result: await runJob('morning', async (site) => {
        const db = useDb()
        const key = encryptionKey()
        const sonos = await getIntegration(db, site.id, 'sonos', key)
        if (!sonos || !(sonos.meta.morning as { enabled?: boolean } | undefined)?.enabled) return { skipped: 'off' }
        if (!(await experimentalSite(db, site.id))) return { skipped: 'not experimental' }
        return startMorning(db, site, key)
      }),
    }
  },
})
