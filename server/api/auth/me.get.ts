/** The logged-in user, their household and the flags the app hides or shows things by. */
export default defineEventHandler(async (event) => {
  const { user, site, role, experimental } = await requireSite(event)
  return {
    email: user.email,
    role: user.role,
    /** Until true, the app shows a "check your email" banner and connecting integrations is refused */
    emailVerified: !!user.emailVerifiedAt,
    /** The user's role in the household */
    member: role,
    /** Effective for the whole household: the owner's setting, always on for an admin owner */
    experimental,
    site: { id: site.id, name: site.name, timezone: site.timezone },
  }
})
