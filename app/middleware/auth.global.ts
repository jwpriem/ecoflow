export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, experimental, loadMe } = useAuth()
  // Pages reached from an email, the how-to guides and the legal texts (also linked from the website) work without logging in
  const open = ['/reset', '/verify', '/invite', '/guides', '/legal'].some((p) => to.path.startsWith(p))
  if (!loggedIn.value && to.path !== '/login' && !open) return navigateTo('/login')
  if (loggedIn.value && to.path === '/login') return navigateTo('/')
  // A new household's owner sets it up first; the guides and legal texts stay reachable from the steps
  if (loggedIn.value && !open && to.path !== '/onboarding') {
    const me = await loadMe().catch(() => null)
    if (me?.onboarding) return navigateTo('/onboarding')
  }
  // The cars come from the experimental integrations: elsewhere the page doesn't exist
  if (loggedIn.value && to.path.startsWith('/cars')) {
    await loadMe().catch(() => undefined)
    if (!experimental.value) return navigateTo('/')
  }
})
