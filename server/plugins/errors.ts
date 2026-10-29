import { initErrorReporting, reportError } from '../services/errors'

/** Sends server errors (5xx, not a user's 4xx) to the error tracker when NUXT_PUBLIC_SENTRY_DSN is set */
export default defineNitroPlugin((nitroApp) => {
  if (!initErrorReporting(useRuntimeConfig().public.sentryDsn)) return
  nitroApp.hooks.hook('error', (error, { event }) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500
    if (status < 500) return
    const siteId = (event?.context as { siteId?: number } | undefined)?.siteId
    reportError(error, { route: event?.path?.split('?')[0], siteId })
  })
})
