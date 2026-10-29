import * as Sentry from '@sentry/vue'
import { NO_PERSONAL_DATA, scrubEvent, scrubValue } from '../../shared/scrub'

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
  return { provide: { reportTestError: () => Sentry.captureMessage('WattsWise test event from the app', 'info') } }
})
