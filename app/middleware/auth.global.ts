export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, experimental, loadMe } = useAuth()
  if (!loggedIn.value && to.path !== '/login') return navigateTo('/login')
  if (loggedIn.value && to.path === '/login') return navigateTo('/')
  // The cars come from the experimental integrations: elsewhere the page doesn't exist
  if (loggedIn.value && to.path.startsWith('/cars')) {
    await loadMe().catch(() => undefined)
    if (!experimental.value) return navigateTo('/')
  }
})
