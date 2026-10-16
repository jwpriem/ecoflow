// Register the service worker that receives Web Push. Skipped in the Capacitor build (it talks to a remote API).
export default defineNuxtPlugin(() => {
  if (useRuntimeConfig().public.apiBase || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[pwa] service worker', err))
})
