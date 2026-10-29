import { readFileSync } from 'node:fs'
import { SITE_PAGES } from './app/utils/site'
import { SKY_BOOT } from './app/utils/skyBoot'

// iOS's Add to Home Screen sheet loads the icon with its own loader, which can fail on a network URL
// and then shows a letter tile. Inlining the 180x180 PNG as a data: URI sidesteps that; the files in
// public/ (including the apple-touch-icon*.png names iOS probes at the root) stay for everything else.
const appleTouchIcon = `data:image/png;base64,${readFileSync(new URL('./public/apple-touch-icon.png', import.meta.url)).toString('base64')}`

// The app is a client-rendered SPA, so the same pages can be wrapped by Capacitor. The public website
// (pages/(site)) is prerendered to HTML at build time, for speed and search engines. The Capacitor build
// (NUXT_APP_BUILD=1, `npm run generate:app`) is the app alone: no website pages, nothing rendered on a server.
const APP_BUILD = process.env.NUXT_APP_BUILD === '1'
/** The website's pages: prerendered, and listed in public/sitemap.xml (tests/site.test.ts checks) */
const SITE_ROUTES = Object.values(SITE_PAGES).flatMap((p) => Object.values(p))

export default defineNuxtConfig({
  compatibilityDate: '2025-10-01',
  ssr: !APP_BUILD,
  // Everything is a client-side app page unless it's a website page. Those are plain HTML without the app's
  // JavaScript (noScripts): nothing on them needs Vue, and a phone on a slow line gets them much sooner.
  routeRules: APP_BUILD
    ? {}
    : { '/**': { ssr: false }, ...Object.fromEntries(SITE_ROUTES.map((r) => [r, { ssr: true, prerender: true, noScripts: true }])) },
  // The website's pages are small: their payload stays inline. (A separate _payload.json would fall under the '/**' app rule.)
  experimental: { payloadExtraction: false },
  hooks: {
    'pages:extend'(pages) {
      if (!APP_BUILD) return
      for (let i = pages.length - 1; i >= 0; i--) if (pages[i]!.file?.includes('/(site)/')) pages.splice(i, 1)
    },
  },
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
        // Archivo with its width axis, served by us (see main.css): no request to Google, so no visitor IP leaves for it
        { rel: 'preload', href: '/fonts/archivo-latin.woff2', as: 'font', type: 'font/woff2', crossorigin: '' },
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
    jobsConcurrency: '', // NUXT_JOBS_CONCURRENCY: households a job works on at once (default 8)
    demoPassword: '', // NUXT_DEMO_PASSWORD: set = the demo account (demo@wattswise.eu) exists with this password
    appleTeamId: '', // NUXT_APPLE_TEAM_ID: the Apple Developer Team ID, for the iOS app's Universal Links (/.well-known/apple-app-site-association)
    appUrl: '', // NUXT_APP_URL: public URL of the server, for the SolarEdge OAuth redirect. Empty = taken from the request
    public: {
      apiBase: '', // NUXT_PUBLIC_API_BASE, empty = same origin; set for the Capacitor build
      sentryDsn: '', // NUXT_PUBLIC_SENTRY_DSN: error reports to Sentry (EU). Empty = off. The DSN only allows sending, so it may be public
    },
  },
  nitro: {
    // .gz and .br next to the static files, served to browsers that accept them
    compressPublicAssets: true,
    experimental: { tasks: true, websocket: false },
    scheduledTasks: {
      '* * * * *': ['collect'],
      '*/5 * * * *': ['vehicles', 'demo'],
      '*/15 * * * *': ['ledger', 'strategy'],
      '5 * * * *': ['prices'],
      '0 * * * *': ['digest'],
      // At night, away from the hourly jobs
      '40 2 * * *': ['retention'],
    },
  },
  typescript: { strict: true },
})
