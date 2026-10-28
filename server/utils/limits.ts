import type { H3Event } from 'h3'
import { RateLimiter } from '../lib/rateLimit'

const MIN = 60_000

/** Per IP and per email, so neither one address nor one machine can keep guessing. */
export const LIMITS = {
  loginIp: new RateLimiter(20, 15 * MIN),
  loginEmail: new RateLimiter(10, 15 * MIN),
  signupIp: new RateLimiter(5, 60 * MIN),
  signupEmail: new RateLimiter(3, 60 * MIN),
  resetIp: new RateLimiter(10, 60 * MIN),
  resetEmail: new RateLimiter(3, 60 * MIN),
  // Guessing a 256-bit token is hopeless, but there is no reason to let anyone try fast
  resetConfirmIp: new RateLimiter(20, 60 * MIN),
  passwordUser: new RateLimiter(10, 60 * MIN),
  verifyResendUser: new RateLimiter(3, 60 * MIN),
  verifyIp: new RateLimiter(20, 60 * MIN),
  inviteUser: new RateLimiter(10, 60 * MIN),
  inviteIp: new RateLimiter(30, 60 * MIN),
}

/** The visitor's address. App Platform puts it in do-connecting-ip; elsewhere the first X-Forwarded-For entry. */
export function clientIp(event: H3Event): string {
  return getHeader(event, 'do-connecting-ip') || getRequestIP(event, { xForwardedFor: true }) || 'unknown'
}

/** 429 once any of the keys has used up its attempts. */
export function rateLimit(...checks: [RateLimiter, string][]) {
  // Count every key, also after one is over: a blocked IP keeps counting against the email and the other way round
  const ok = checks.map(([limiter, key]) => limiter.hit(key)).every(Boolean)
  if (!ok) throw createError({ statusCode: 429, statusMessage: 'Too many attempts, try again later' })
}
