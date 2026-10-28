import { backoffDelay, CircuitBreaker, RateBudget, retryAfterMs } from '../lib/backoff'

export type Provider = 'tibber' | 'ecoflow' | 'solaredge' | 'openmeteo'

/** The provider failed often enough that calls are held back for a while */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: Provider,
    readonly retryInMs: number,
  ) {
    super(`${NAMES[provider]} is not answering, trying again in ${Math.ceil(retryInMs / 1000)} s`)
  }
}

const NAMES: Record<Provider, string> = { tibber: 'Tibber', ecoflow: 'EcoFlow', solaredge: 'SolarEdge', openmeteo: 'Open-Meteo' }

/**
 * Tibber allows 100 requests per 5 minutes per IP address (developer.tibber.com, "Communicating with the API"),
 * and every household is called from the same server; 90 leaves room for the websocket URL lookups.
 */
const BUDGETS: Partial<Record<Provider, () => RateBudget>> = { tibber: () => new RateBudget(90, 5 * 60_000) }

const state = new Map<Provider, { breaker: CircuitBreaker; budget?: RateBudget }>()
function of(provider: Provider) {
  let s = state.get(provider)
  if (!s) state.set(provider, (s = { breaker: new CircuitBreaker(), budget: BUDGETS[provider]?.() }))
  return s
}

export interface CallOptions {
  /** Retries after the first attempt */
  retries?: number
  /** Whether a response is worth another try; by default 429 and 5xx */
  retryable?: (res: Response) => boolean
  /** A Retry-After longer than this isn't waited for: the response goes back as it is */
  maxWaitMs?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

const transient = (res: Response) => res.status === 429 || res.status >= 500
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * One HTTP call to a provider. `request` builds it anew for each attempt (EcoFlow signs every request with a
 * fresh nonce) and gets an abort signal for the timeout. 429/5xx and network errors are retried with backoff,
 * honouring Retry-After. Failures count towards the provider's circuit breaker, so an outage isn't hammered
 * by every household; Tibber calls also wait for room in the per-IP budget.
 * Returns the last response; the caller still reads its status.
 */
export async function providerCall(provider: Provider, request: (signal: AbortSignal) => Promise<Response>, opts: CallOptions = {}): Promise<Response> {
  const { retries = 2, retryable = transient, maxWaitMs = 10_000, timeoutMs = 30_000, sleep = realSleep, random } = opts
  const { breaker, budget } = of(provider)
  for (let attempt = 0; ; attempt++) {
    const check = () => {
      const blocked = breaker.blockedFor()
      if (blocked > 0) throw new ProviderUnavailableError(provider, blocked)
    }
    check()
    if (budget) {
      await budget.take(sleep)
      // The provider may have gone down while this call waited for room
      check()
    }
    let res: Response
    try {
      res = await request(AbortSignal.timeout(timeoutMs))
    } catch (err) {
      breaker.failure()
      if (attempt >= retries) throw err
      await sleep(backoffDelay(attempt, { maxMs: maxWaitMs, random }))
      continue
    }
    if (!retryable(res)) {
      // A 4xx that isn't a rate limit is the household's own problem (a wrong key), not the provider's
      if (!transient(res)) breaker.success()
      return res
    }
    breaker.failure()
    const wait = retryAfterMs(res.headers.get('retry-after')) ?? backoffDelay(attempt, { maxMs: maxWaitMs, random })
    if (attempt >= retries || wait > maxWaitMs) return res
    await res.body?.cancel().catch(() => {})
    await sleep(wait)
  }
}

/** For tests: forget breakers and budgets */
export function resetProviders() {
  state.clear()
}
