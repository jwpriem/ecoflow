export default defineEventHandler(async (event) => {
  const { user, site } = await requireSite(event)
  return { email: user.email, site: { id: site.id, name: site.name, timezone: site.timezone } }
})
