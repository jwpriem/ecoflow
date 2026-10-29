import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { ONBOARDING_STEPS, type OnboardingStep } from '../../shared/onboarding'
import type { Db } from '../db/client'
import { devices, integrations, sites } from '../db/schema'

type Site = typeof sites.$inferSelect

/** Why a step can't be left yet, or null when it can. Tibber with a Pulse and at least one battery are required (JER-7). */
async function blocker(db: Db, site: Site, step: OnboardingStep): Promise<string | null> {
  if (step === 'tibber') {
    const [t] = await db.select().from(integrations).where(and(eq(integrations.siteId, site.id), eq(integrations.provider, 'tibber')))
    if (!t || t.status !== 'ok') return 'Connect Tibber first'
    if (!t.meta.realtime) return 'WattsWise needs a Tibber Pulse'
  }
  if (step === 'ecoflow') {
    const [d] = await db.select({ id: devices.id }).from(devices).where(eq(devices.siteId, site.id)).limit(1)
    if (!d) return 'Connect your EcoFlow batteries first'
  }
  return null
}

/**
 * Move the owner's onboarding to `to` (a step, or 'done'). Going back is always fine; going forward only one
 * step at a time from the current one, and only past a required step once it's complete.
 */
export async function moveOnboarding(db: Db, site: Site, to: OnboardingStep | 'done') {
  if (!site.onboarding) throw createError({ statusCode: 409, statusMessage: 'Onboarding is already done' })
  const cur = ONBOARDING_STEPS.indexOf(site.onboarding)
  const next = to === 'done' ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.indexOf(to)
  if (next < 0) throw createError({ statusCode: 400, statusMessage: 'Unknown step' })
  if (next > cur + 1) throw createError({ statusCode: 409, statusMessage: 'Finish the steps in order' })
  if (next > cur) {
    const why = await blocker(db, site, site.onboarding)
    if (why) throw createError({ statusCode: 409, statusMessage: why })
  }
  const onboarding = to === 'done' ? null : to
  const [updated] = await db.update(sites).set({ onboarding }).where(eq(sites.id, site.id)).returning()
  return updated!
}
