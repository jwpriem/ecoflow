export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, experimental, loadMe } = useAuth()
  // Pages reached from an email, and the how-to guides (also linked from the website), work without logging in
  const open = ['/reset', '/verify', '/invite', '/guides'].some((p) => to.path.startsWith(p))
  if (!loggedIn.value && to.path !== '/login' && !open) return navigateTo('/login')
  if (loggedIn.value && to.path === '/login') return navigateTo('/')
  // The cars come from the experimental integrations: elsewhere the page doesn't exist
  if (loggedIn.value && to.path.startsWith('/cars')) {
    await loadMe().catch(() => undefined)
    if (!experimental.value) return navigateTo('/')
  }
})
