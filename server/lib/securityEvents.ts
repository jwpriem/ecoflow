/**
 * Counts security-relevant events in memory (one instance), so an hourly check can tell when something
 * unusual is going on: many failed logins, many refused requests. Counts only, no addresses or emails.
 */
export type SecurityEvent = 'loginFailed' | 'rateLimited'

/** Per hour, above these the hourly check raises an alert (Sentry warning + log line) */
export const ALERT_THRESHOLDS: Record<SecurityEvent, number> = {
  loginFailed: 50,
  rateLimited: 200,
}

export class SecurityCounter {
  private counts: Record<SecurityEvent, number> = { loginFailed: 0, rateLimited: 0 }

  record(kind: SecurityEvent) {
    this.counts[kind]++
  }

  /** The counts since the last flush, and which ones went over their threshold. Starts a new period. */
  flush(): { counts: Record<SecurityEvent, number>; alerts: SecurityEvent[] } {
    const counts = this.counts
    this.counts = { loginFailed: 0, rateLimited: 0 }
    const alerts = (Object.keys(counts) as SecurityEvent[]).filter((k) => counts[k] > ALERT_THRESHOLDS[k])
    return { counts, alerts }
  }
}

export const securityEvents = new SecurityCounter()
