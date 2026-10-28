import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { siteMembers, sites, users } from '../db/schema'
import { stopEcoFlowMqtt } from '../providers/ecoflow/mqtt'
import { forgetTibberApp } from '../providers/tibberApp'
import { stopPulse } from '../providers/tibberPulse'
import { forgetLive } from './collector'
import { moveOut } from './household'
import { forgetSolarEdge } from './solaredge'
import { stopZeekr } from './zeekr'

/** Closes the live connections of a household and drops what is cached for it in memory. */
export function stopSite(siteId: number) {
  stopPulse(siteId)
  stopEcoFlowMqtt(siteId)
  forgetSolarEdge(siteId)
  stopZeekr(siteId)
  forgetLive(siteId)
  // Tokens are cached per Tibber account, not per site: clearing all costs the others one extra login
  forgetTibberApp()
}

/**
 * Deletes the user, right away. An owner takes the household with them, and every row under it (the foreign keys
 * cascade from site_id); its members keep their accounts and get an empty household of their own. A member only
 * deletes themselves. Returns the deleted household and its former members, for the email that tells them.
 * Used by the app (DELETE /api/account) and the admin panel.
 */
export async function deleteAccount(db: Db, userId: number) {
  const [m] = await db.select().from(siteMembers).where(eq(siteMembers.userId, userId))
  if (m?.role !== 'owner') {
    await db.delete(users).where(eq(users.id, userId))
    return { household: null, members: [] }
  }
  const [site] = await db.select({ name: sites.name }).from(sites).where(eq(sites.id, m.siteId))
  const members = await db
    .select({ id: users.id, email: users.email, locale: users.locale })
    .from(siteMembers)
    .innerJoin(users, eq(users.id, siteMembers.userId))
    .where(and(eq(siteMembers.siteId, m.siteId), eq(siteMembers.role, 'member')))
  // Before the rows go, so no Pulse or MQTT message is written for a household that no longer exists
  stopSite(m.siteId)
  await db.transaction(async (tx) => {
    for (const member of members) await moveOut(tx, member.id)
    await tx.delete(sites).where(eq(sites.id, m.siteId))
    await tx.delete(users).where(eq(users.id, userId))
  })
  return { household: { id: m.siteId, name: site!.name }, members }
}
