import { household } from '../../services/household'

/** The household's members, its rough location for the solar forecast, and for the owner the invitations still open. */
export default defineEventHandler(async (event) => {
  const { user, site, role } = await requireSite(event)
  const { members, invites } = await household(useDb(), site.id)
  return { name: site.name, location: site.location, role, members: members.map((m) => ({ ...m, you: m.userId === user.id })), invites: role === 'owner' ? invites : [] }
})
