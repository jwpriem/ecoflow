import { securityEvents } from '../lib/securityEvents'
import { reportSecurityAlert } from '../services/errors'

const HOUR = 60 * 60_000

/**
 * Once an hour: log the number of failed logins and refused (429) requests when there were any, and raise an
 * alert in Sentry when one goes over its threshold (lib/securityEvents.ts).
 */
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  const timer = setInterval(() => {
    const { counts, alerts } = securityEvents.flush()
    if (counts.loginFailed || counts.rateLimited) console.info(`[security] last hour: failedLogins=${counts.loginFailed} rateLimited=${counts.rateLimited}`)
    for (const kind of alerts) {
      console.warn(`[security] ALERT ${kind}=${counts[kind]} in the last hour`)
      reportSecurityAlert(kind, counts[kind])
    }
  }, HOUR)
  timer.unref?.()
})
