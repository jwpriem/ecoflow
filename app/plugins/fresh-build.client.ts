import { getAppManifest } from '#app'

// A phone keeps the web app open for days. After a deploy that old copy still runs: it asks the new server for
// things it does not know yet, and the code it loads later (a page, a component) no longer exists on the server
// ("Importing a module script failed"). Nuxt only looks for a new version once an hour, and an iPhone pauses that
// timer while the app is in the background. So: look again each time the app comes back to the screen and load the
// new version right away, before it is used, and reload when a piece of code can no longer be loaded.
// Not in the iOS build: that carries its own copy of the code, there is nothing to reload.
const CHECK_EVERY_MS = 60_000

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()
  if (config.public.apiBase || import.meta.dev) return
  const router = useRouter()

  // ttl: at most once per 30 s for the same page, so a reload that does not help (server down) never loops
  const reload = () => reloadNuxtApp({ path: router.currentRoute.value.fullPath, persistState: true, ttl: 30_000 })

  let lastCheck = Date.now()
  const check = async () => {
    if (Date.now() - lastCheck < CHECK_EVERY_MS) return
    lastCheck = Date.now()
    try {
      const [current, latest] = await Promise.all([
        getAppManifest(),
        $fetch<{ id: string }>(`${config.app.buildAssetsDir.replace(/\/$/, '')}/builds/latest.json?${Date.now()}`),
      ])
      if (latest?.id && current?.id && latest.id !== current.id) reload()
    } catch {}
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  // A page or component from an older build that is gone from the server: Nuxt itself only handles this during a
  // navigation, this also covers code loaded while staying on a page
  nuxtApp.hook('app:chunkError', () => reload())
})
