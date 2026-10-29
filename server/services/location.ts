import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { sites } from '../db/schema'
import { coarseLocation, type SiteLocation } from '../lib/location'
import type { TibberHome } from '../providers/tibber'

type Site = typeof sites.$inferSelect

const same = (a: SiteLocation | null | undefined, b: SiteLocation) => !!a && a.lat === b.lat && a.lon === b.lon && a.place === b.place && a.source === b.source

async function save(db: Db, site: Site, location: SiteLocation | null) {
  const [updated] = await db.update(sites).set({ location }).where(eq(sites.id, site.id)).returning()
  return updated!
}

/**
 * Take the household's rough location from its Tibber home, unless the owner set one by hand.
 * Returns the site and whether the location changed (then the forecast should be fetched again).
 */
export async function locationFromTibber(db: Db, site: Site, home: TibberHome): Promise<{ site: Site; changed: boolean }> {
  if (site.location?.source === 'manual') return { site, changed: false }
  const loc = coarseLocation(home.address?.latitude, home.address?.longitude, 'tibber', home.address?.city)
  if (!loc || same(site.location, loc)) return { site, changed: false }
  return { site: await save(db, site, loc), changed: true }
}

/** The owner sets the location by hand; null goes back to the Tibber home's on the next Tibber check */
export async function setLocation(db: Db, site: Site, location: SiteLocation | null): Promise<Site> {
  return save(db, site, location)
}
