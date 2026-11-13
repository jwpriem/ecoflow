import * as Sentry from '@sentry/vue'
import { NO_PERSONAL_DATA, scrubEvent, scrubValue } from '#shared/scrub'

// Error reports from the app (browser and Capacitor) to Sentry (EU), only when NUXT_PUBLIC_SENTRY_DSN is set.
// Errors only, no session replay or tracing; every event goes through the same scrubber as on the server.
export default defineNuxtPlugin((nuxtApp) => {
  const dsn = useRuntimeConfig().public.sentryDsn
  if (!dsn) return
  Sentry.init({
    app: nuxtApp.vueApp,
    dsn,
    environment: import.meta.dev ? 'development' : 'production',
    dataCollection: NO_PERSONAL_DATA,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubValue(crumb) as typeof crumb,
  })
  // Sentry wraps Nuxt's start-up error handler, and Nuxt only removes that handler when it is still its own. Left
  // alone, every later error in a component (a camera stream, a button) would replace the whole app with the
  // 500 page. Once the app is up, errors only go to Sentry and the console; the component shows its own state.
  nuxtApp.hook('app:suspense:resolve', () => {
    nuxtApp.vueApp.config.errorHandler = (err, instance, info) => {
      Sentry.captureException(err, { contexts: { vue: { lifecycleHook: info } } })
      console.error(err)
    }
  })
  return { provide: { reportTestError: () => Sentry.captureMessage('WattsWise test event from the app', 'info') } }
})
