/**
 * Live check against the EcoFlow developer API. Skipped unless both keys are set:
 *   ECOFLOW_ACCESS_KEY=… ECOFLOW_SECRET_KEY=… npm run test:live
 * ECOFLOW_HOST overrides the EU host. Prints no secrets, only what the units report.
 */
import { describe, expect, it } from 'vitest'
import { deviceQuota, listDevices, parseStreamQuota, streamDevices } from '../server/providers/ecoflow'

const accessKey = process.env.ECOFLOW_ACCESS_KEY ?? ''
const secretKey = process.env.ECOFLOW_SECRET_KEY ?? ''
const opts = { host: process.env.ECOFLOW_HOST || undefined }

describe.skipIf(!accessKey || !secretKey)('EcoFlow live API', () => {
  const creds = { accessKey, secretKey }

  it('lists the STREAM units and reads each one', async () => {
    const list = streamDevices(await listDevices(creds, opts))
    expect(list.length).toBeGreaterThan(0)
    for (const d of list) {
      const quota = await deviceQuota(creds, d.sn, opts)
      const r = parseStreamQuota(quota)
      console.info(`${d.productName} ${d.deviceName} online=${d.online}`, r, `keys: ${Object.keys(quota).sort().join(', ')}`)
      expect(Object.keys(quota).length).toBeGreaterThan(0)
      if (d.online === 1) expect(r.soc).not.toBeNull()
    }
  }, 30_000)
})
