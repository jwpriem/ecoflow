import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertOwner } from '../server/services/members'

/**
 * Who may call each route that changes something (JER-5). A new route fails this test until it's listed here.
 * - owner: steering on or off, the connections, members, deleting the household
 * - household: anyone in it, owner or member
 * - account: about the logged-in user only, not the household
 * - public: no login (signing in and first-run setup)
 */
const ACCESS: Record<string, 'owner' | 'household' | 'account' | 'public'> = {
  'auth/login.post.ts': 'public',
  'auth/signup.post.ts': 'public',
  // The owner's household goes with it: deciding that is the account holder's own, checked with the password
  'account/index.delete.ts': 'account',
  'auth/logout.post.ts': 'account',
  'auth/logout-all.post.ts': 'account',
  'auth/password.put.ts': 'account',
  'auth/reset/request.post.ts': 'public',
  'auth/reset/confirm.post.ts': 'public',
  'auth/verify/index.post.ts': 'public',
  'auth/verify/resend.post.ts': 'account',
  'household/invites/index.post.ts': 'owner',
  'household/invites/[id].delete.ts': 'owner',
  'household/members/[id].delete.ts': 'owner',
  // A member leaves; the owner is refused inside
  'household/leave.post.ts': 'household',
  // The invitation link: reading it and signing up need no login, accepting is for the logged-in invitee
  'invite/details.post.ts': 'public',
  'invite/signup.post.ts': 'public',
  'invite/accept.post.ts': 'account',
  'integrations/[provider].put.ts': 'owner',
  'integrations/[provider].delete.ts': 'owner',
  // A GET, but it starts the SolarEdge sign-in and stores its state
  'integrations/[provider]/authorize.get.ts': 'owner',
  'ecoflow/steering.put.ts': 'owner',
  // Overrides are for the household; its controlMode field (steering on or off) is checked for the owner inside
  'plan/override.post.ts': 'household',
  'strategy.put.ts': 'household',
  'devices/[id].put.ts': 'household',
  'vehicles/[id].put.ts': 'household',
  'vehicles/[id]/departure.put.ts': 'household',
  // Subscriptions belong to this device: anyone in the household can turn their own notifications on or off
  'push/index.put.ts': 'household',
  'push/index.delete.ts': 'household',
  'push/test.post.ts': 'household',
}

const API = 'server/api'
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p.slice(API.length + 1)]
  })
}
const mutating = files(API).filter((f) => /\.(put|post|patch|delete)\.ts$/.test(f) || f in ACCESS)
const source = (f: string) => readFileSync(join(API, f), 'utf8')

describe('route permissions', () => {
  it('lists every route that changes something', () => {
    expect(mutating.filter((f) => !(f in ACCESS))).toEqual([])
  })

  it.each(Object.entries(ACCESS).filter(([, a]) => a === 'owner'))('%s is owner-only', (f) => {
    expect(source(f)).toMatch(/requireOwner\(event\)/)
  })

  it.each(Object.entries(ACCESS).filter(([, a]) => a === 'household'))('%s is open to the whole household', (f) => {
    expect(source(f)).toMatch(/requireSite\(event\)/)
    expect(source(f)).not.toMatch(/requireOwner\(event\)/)
  })

  it('lets only the owner switch steering on or off through an override', () => {
    expect(source('plan/override.post.ts')).toMatch(/if \(body\.controlMode !== undefined\) assertOwner\(role\)/)
  })
})

describe('assertOwner', () => {
  it('lets the owner through and refuses a member with a 403', () => {
    expect(() => assertOwner('owner')).not.toThrow()
    expect(() => assertOwner('member')).toThrow(expect.objectContaining({ statusCode: 403 }))
  })
})
