import { STEERING_VERSION } from '../../lib/legal'
import { steeringConsentDue } from '../../services/consent'

/** The logged-in user, their household and the flags the app hides or shows things by. */
export default defineEventHandler(async (event) => {
  const { user, site, role, experimental } = await requireSite(event)
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    /** Until true, the app shows a "check your email" banner and connecting integrations is refused */
    emailVerified: !!user.emailVerifiedAt,
    /** The user's role in the household */
    member: role,
    /** Effective for the whole household: the owner's setting, always on for an admin owner */
    experimental,
    site: { id: site.id, name: site.name, timezone: site.timezone },
    /** The shared, read-only demo household: the app shows the demo banner */
    demo: site.isDemo,
    /** The onboarding step the owner is on, or null once done; members never go through onboarding */
    onboarding: role === 'owner' ? site.onboarding : null,
    /** The steering disclaimer changed since the owner accepted it: the app asks again (steering keeps running) */
    steeringConsentDue: (await steeringConsentDue(useDb(), site, user.id, role)) ? STEERING_VERSION : null,
  }
})
