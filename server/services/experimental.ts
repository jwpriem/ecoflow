import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { Db } from '../db/client'
import { siteMembers, users, type Provider } from '../db/schema'
import { experimentalEnabled } from './members'

/**
 * Integrations only the owner's own household uses: Zeekr and the Tibber app, with the cars and Tibber's
 * EV charging behind them. A household without experimental on never sees or calls them; switching it off
 * keeps their credentials and data, they are just no longer used.
 */
export const EXPERIMENTAL_PROVIDERS: readonly Provider[] = ['zeekr', 'tibber_app']

export const isExperimentalProvider = (provider: Provider) => EXPERIMENTAL_PROVIDERS.includes(provider)

/** The providers a household may see: everything, or everything but the experimental ones. */
export const visibleProviders = (all: readonly Provider[], experimental: boolean) =>
  experimental ? [...all] : all.filter((p) => !isExperimentalProvider(p))

/** 403 for anything experimental (the cars, or an experimental provider) when the household has it off. */
export function assertExperimental(experimental: boolean, provider?: Provider) {
  if (experimental || (provider && !isExperimentalProvider(provider))) return
  throw createError({ statusCode: 403, statusMessage: 'Not available for this household' })
}

/** For background work, which has a site but no session: is experimental on for this household? */
export async function experimentalSite(db: Db, siteId: number): Promise<boolean> {
  const [owner] = await db
    .select({ role: users.role, experimental: users.experimental })
    .from(siteMembers)
    .innerJoin(users, eq(users.id, siteMembers.userId))
    .where(and(eq(siteMembers.siteId, siteId), eq(siteMembers.role, 'owner')))
    .limit(1)
  return experimentalEnabled(owner ?? null)
}
