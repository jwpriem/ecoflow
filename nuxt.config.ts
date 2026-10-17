// The whole UI is a client-rendered SPA so the same build can be wrapped by Capacitor.
// The Nitro server (API + background jobs) is deployed separately on DO App Platform.
export default defineNuxtConfig({
  compatibilityDate: '2025-10-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: 'WattWise',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        // Installable as a PWA (Add to Home Screen); iOS needs that for Web Push
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'WattWise' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
  runtimeConfig: {
    databaseUrl: '', // NUXT_DATABASE_URL
    encryptionKey: '', // NUXT_ENCRYPTION_KEY (base64, 32 bytes)
    jobsEnabled: 'true', // NUXT_JOBS_ENABLED
    setupCode: '', // NUXT_SETUP_CODE: required to create the first account when set
    appUrl: '', // NUXT_APP_URL: public URL of the server, for the SolarEdge OAuth redirect. Empty = taken from the request
    public: {
      apiBase: '', // NUXT_PUBLIC_API_BASE, empty = same origin; set for the Capacitor build
    },
  },
  nitro: {
    experimental: { tasks: true, websocket: false },
    scheduledTasks: {
      '* * * * *': ['collect'],
      '*/15 * * * *': ['ledger', 'strategy'],
      '5 * * * *': ['prices'],
      '0 * * * *': ['digest'],
    },
  },
  typescript: { strict: true },
})
