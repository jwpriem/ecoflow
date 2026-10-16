// The whole UI is a client-rendered SPA so the same build can be wrapped by Capacitor.
// The Nitro server (API + background jobs) is deployed separately on DO App Platform.
export default defineNuxtConfig({
  compatibilityDate: '2025-10-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: 'Battery',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
    },
  },
  runtimeConfig: {
    databaseUrl: '', // NUXT_DATABASE_URL
    encryptionKey: '', // NUXT_ENCRYPTION_KEY (base64, 32 bytes)
    jobsEnabled: 'true', // NUXT_JOBS_ENABLED
    setupCode: '', // NUXT_SETUP_CODE: required to create the first account when set
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
    },
  },
  typescript: { strict: true },
})
