import * as Sentry from '@sentry/node'
import { NO_PERSONAL_DATA, scrubEvent, scrubValue } from '../../shared/scrub'

let enabled = false

/**
 * Error reports to Sentry (EU region, de.sentry.io). Off unless NUXT_PUBLIC_SENTRY_DSN is set. Every event
 * goes through the scrubber first; no tracing or profiling, errors only.
 */
export function initErrorReporting(dsn: string | undefined, environment = process.env.NODE_ENV ?? 'production') {
  if (!dsn || enabled) return false
  Sentry.init({
    dsn,
    environment,
    dataCollection: NO_PERSONAL_DATA,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubValue(crumb) as typeof crumb,
  })
  enabled = true
  return true
}

/** Tags are numbers and names only: the household's id, the job, the provider. Never an email or address. */
export interface ErrorTags {
  siteId?: number
  job?: string
  provider?: string
  route?: string
}

export function reportError(err: unknown, tags: ErrorTags = {}) {
  if (!enabled) return
  const provider = tags.provider ?? (err as { provider?: unknown })?.provider
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries({ ...tags, provider })) if (v !== undefined) scope.setTag(k, String(v))
    Sentry.captureException(err)
  })
}

/** For the admin's test button and the PR check: one event that shows reports arrive */
export function reportTestEvent(where: 'server') {
  if (!enabled) return false
  Sentry.captureMessage(`WattsWise test event from the ${where}`, 'info')
  return true
}
