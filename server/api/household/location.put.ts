import { coarseLocation } from '../../lib/location'
import { tibberHomes, type TibberCredentials } from '../../providers/tibber'
import { getIntegration } from '../../services/integrations'
import { locationFromTibber, setLocation } from '../../services/location'
import { refreshIrradiance } from '../../services/solarForecast'

/**
 * Body: { lat, lon, place? } sets the household's rough location for the solar forecast by hand (rounded to 0.1°),
 * or { clear: true } goes back to the Tibber home's location. Owner only.
 */
export default defineEventHandler(async (event) => {
  const { site } = await requireOwner(event)
  const b = await readBody<{ lat?: unknown; lon?: unknown; place?: string; clear?: boolean }>(event)
  const location = b.clear ? null : coarseLocation(b.lat, b.lon, 'manual', b.place)
  if (!b.clear && !location) throw createError({ statusCode: 400, statusMessage: 'Enter a latitude and longitude' })
  const db = useDb()
  let updated = await setLocation(db, site, location)
  // Back to the Tibber home: read it now rather than at the next Tibber check
  if (b.clear) {
    const tibber = await getIntegration<TibberCredentials>(db, site.id, 'tibber', encryptionKey())
    const homes = tibber ? await tibberHomes(tibber.creds).catch(() => []) : []
    const home = homes.find((h) => h.id === tibber?.meta.homeId) ?? homes[0]
    if (home) updated = (await locationFromTibber(db, updated, home)).site
  }
  await refreshIrradiance(db, updated).catch(() => undefined)
  return { location: updated.location }
})
