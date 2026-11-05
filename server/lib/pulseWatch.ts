/**
 * When to tell the household that the Tibber Pulse went quiet, and when it is back.
 * Pure, so it can be tested without a socket or a database. The state lives in the Tibber integration's meta,
 * so a restart neither repeats the alert nor forgets that one was sent.
 */

/** No reading for this long counts as an outage worth a notification (a router restart stays below it) */
export const PULSE_ALERT_AFTER_MS = 15 * 60_000
/** Readings count as back once the latest one is this fresh */
export const PULSE_BACK_WITHIN_MS = 2 * 60_000

export interface PulseWatchState {
  /** ISO time of the last reading before the outage; set once the outage notification went out */
  pulseDownSince?: string
}

export type PulseWatchStep =
  | { kind: 'none' }
  | { kind: 'down'; since: Date }
  | { kind: 'up'; downSince: Date; downForMs: number }

/**
 * @param lastReadingAt latest reading this process received, or null when none came in since it started
 * @param watchingSince when this process started listening (no reading before that is known here)
 * @param lastStoredAt latest Pulse reading stored in the database, used for the "since" of an outage that began before a restart
 */
export function pulseWatchStep(
  state: PulseWatchState,
  p: { lastReadingAt: number | null; watchingSince: number; lastStoredAt: number | null },
  now: number,
): PulseWatchStep {
  const down = state.pulseDownSince ? new Date(state.pulseDownSince) : null
  if (down) {
    if (p.lastReadingAt !== null && now - p.lastReadingAt <= PULSE_BACK_WITHIN_MS) {
      return { kind: 'up', downSince: down, downForMs: p.lastReadingAt - down.getTime() }
    }
    return { kind: 'none' }
  }
  const last = p.lastReadingAt ?? p.lastStoredAt
  // Only judge after listening long enough ourselves: right after a restart nothing has come in yet
  const quietFor = now - Math.max(p.lastReadingAt ?? 0, p.watchingSince)
  if (quietFor < PULSE_ALERT_AFTER_MS) return { kind: 'none' }
  return { kind: 'down', since: new Date(last ?? p.watchingSince) }
}
