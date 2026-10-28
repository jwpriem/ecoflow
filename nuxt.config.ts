import { readFileSync } from 'node:fs'
import { SKY_BOOT } from './app/utils/skyBoot'

// iOS's Add to Home Screen sheet loads the icon with its own loader, which can fail on a network URL
// and then shows a letter tile. Inlining the 180x180 PNG as a data: URI sidesteps that; the files in
// public/ (including the apple-touch-icon*.png names iOS probes at the root) stay for everything else.
const appleTouchIcon = `data:image/png;base64,${readFileSync(new URL('./public/apple-touch-icon.png', import.meta.url)).toString('base64')}`

// The whole UI is a client-rendered SPA so the same build can be wrapped by Capacitor.
// The Nitro server (API + background jobs) is deployed separately on DO App Platform.
export default defineNuxtConfig({
  compatibilityDate: '2025-10-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: 'WattsWise',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        // Installable as a PWA (Add to Home Screen); iOS needs that for Web Push
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'WattsWise' },
        // apple-mobile-web-app-status-bar-style and theme-color are written by SKY_BOOT, from the sun
      ],
      script: [{ innerHTML: SKY_BOOT, tagPosition: 'head' }],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        // Archivo with its width axis: wide for the status line, condensed for numbers
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg?v=4' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png?v=4' },
        // PNG only: iOS can't use SVG for the Home Screen icon
        { rel: 'apple-touch-icon', sizes: '180x180', href: appleTouchIcon },
      ],
    },
  },
  runtimeConfig: {
    databaseUrl: '', // NUXT_DATABASE_URL
    encryptionKey: '', // NUXT_ENCRYPTION_KEY (base64, 32 bytes)
    jobsEnabled: 'true', // NUXT_JOBS_ENABLED
    appUrl: '', // NUXT_APP_URL: public URL of the server, for the SolarEdge OAuth redirect. Empty = taken from the request
    public: {
      apiBase: '', // NUXT_PUBLIC_API_BASE, empty = same origin; set for the Capacitor build
    },
  },
  nitro: {
    experimental: { tasks: true, websocket: false },
    scheduledTasks: {
      '* * * * *': ['collect'],
      '*/5 * * * *': ['vehicles'],
      '*/15 * * * *': ['ledger', 'strategy'],
      '5 * * * *': ['prices'],
      '0 * * * *': ['digest'],
      // At night, away from the hourly jobs
      '40 2 * * *': ['retention'],
    },
  },
  typescript: { strict: true },
})
