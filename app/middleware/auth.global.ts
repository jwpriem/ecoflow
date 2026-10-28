export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, experimental, loadMe } = useAuth()
  // Pages reached from an email work without logging in
  if (!loggedIn.value && to.path !== '/login' && !to.path.startsWith('/reset') && !to.path.startsWith('/verify') && !to.path.startsWith('/invite')) return navigateTo('/login')
  if (loggedIn.value && to.path === '/login') return navigateTo('/')
  // The cars come from the experimental integrations: elsewhere the page doesn't exist
  if (loggedIn.value && to.path.startsWith('/cars')) {
    await loadMe().catch(() => undefined)
    if (!experimental.value) return navigateTo('/')
  }
})
