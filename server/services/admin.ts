import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { Db } from '../db/client'
import { adminAudit, devices, integrations, sessions, siteMembers, sites, users } from '../db/schema'
import { liveState } from './collector'

export const ADMIN_PAGE = 50

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const pageOf = (page: unknown) => Math.max(0, Math.floor(Number(page) || 0))

/** Integration health per household: status and the last error, never credentials or meta. */
async function connectionsOf(db: Db, siteIds: number[]) {
  if (!siteIds.length) return new Map<number, { provider: string; status: string; lastOkAt: Date | null; lastError: string | null }[]>()
  const rows = await db
    .select({ siteId: integrations.siteId, provider: integrations.provider, status: integrations.status, lastOkAt: integrations.lastOkAt, lastError: integrations.lastError })
    .from(integrations)
    .where(inArray(integrations.siteId, siteIds))
    .orderBy(integrations.provider)
  const out = new Map<number, Omit<(typeof rows)[number], 'siteId'>[]>()
  for (const { siteId, ...c } of rows) out.set(siteId, [...(out.get(siteId) ?? []), c])
  return out
}

/** Users, newest first, matching the email search. Never a password hash or token. */
export async function listUsers(db: Db, q = '', page: unknown = 0) {
  const where = q ? ilike(users.email, like(q)) : undefined
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      experimental: users.experimental,
      locale: users.locale,
      emailVerifiedAt: users.emailVerifiedAt,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
      lastSeenAt: sql<Date | null>`(SELECT max(coalesce(${sessions.lastUsedAt}, ${sessions.createdAt})) FROM ${sessions} WHERE ${sessions.userId} = ${users.id})`.mapWith(
        (v) => (v ? new Date(v) : null),
      ),
      household: { id: sites.id, name: sites.name, role: siteMembers.role },
    })
    .from(users)
    .leftJoin(siteMembers, eq(siteMembers.userId, users.id))
    .leftJoin(sites, eq(sites.id, siteMembers.siteId))
    .where(where)
    .orderBy(desc(users.id))
    .limit(ADMIN_PAGE)
    .offset(pageOf(page) * ADMIN_PAGE)
  const [total] = await db.select({ n: count() }).from(users).where(where)
  const conns = await connectionsOf(db, rows.flatMap((r) => (r.household?.id ? [r.household.id] : [])))
  return {
    total: total!.n,
    users: rows.map((r) => ({ ...r, household: r.household?.id ? r.household : null, connections: r.household?.id ? (conns.get(r.household.id) ?? []) : [] })),
  }
}

/** Households, newest first, matching their name or a member's email. */
export async function listHouseholds(db: Db, q = '', page: unknown = 0) {
  const where = q
    ? or(
        ilike(sites.name, like(q)),
        exists(
          db
            .select({ one: sql`1` })
            .from(siteMembers)
            .innerJoin(users, eq(users.id, siteMembers.userId))
            .where(and(eq(siteMembers.siteId, sites.id), ilike(users.email, like(q)))),
        ),
      )
    : undefined
  const rows = await db
    .select({ id: sites.id, name: sites.name, controlMode: sites.controlMode, timezone: sites.timezone, createdAt: sites.createdAt })
    .from(sites)
    .where(where)
    .orderBy(desc(sites.id))
    .limit(ADMIN_PAGE)
    .offset(pageOf(page) * ADMIN_PAGE)
  const [total] = await db.select({ n: count() }).from(sites).where(where)
  const ids = rows.map((r) => r.id)
  const members = ids.length
    ? await db
        .select({ siteId: siteMembers.siteId, userId: users.id, email: users.email, role: siteMembers.role })
        .from(siteMembers)
        .innerJoin(users, eq(users.id, siteMembers.userId))
        .where(inArray(siteMembers.siteId, ids))
        .orderBy(asc(siteMembers.createdAt))
    : []
  const devs = ids.length
    ? await db.select({ siteId: devices.siteId, id: devices.id, name: devices.name, model: devices.model }).from(devices).where(inArray(devices.siteId, ids)).orderBy(devices.id)
    : []
  const conns = await connectionsOf(db, ids)
  const pick = <T extends { siteId: number }>(list: T[], id: number) => list.filter((x) => x.siteId === id).map(({ siteId: _, ...x }) => x)
  return {
    total: total!.n,
    households: rows.map((r) => ({
      ...r,
      members: pick(members, r.id),
      devices: pick(devs, r.id),
      connections: conns.get(r.id) ?? [],
      // From the collector's memory: null until its first tick after a restart, or when jobs are off
      lastCollectAt: liveState(r.id)?.ts ?? null,
    })),
  }
}

export async function audit(db: Db, adminId: number, action: string, targetUserId: number | null, detail: Record<string, unknown> = {}) {
  await db.insert(adminAudit).values({ adminId, action, targetUserId, detail })
}

export async function recentAudit(db: Db, limit = 50) {
  return db
    .select({ id: adminAudit.id, admin: users.email, action: adminAudit.action, targetUserId: adminAudit.targetUserId, detail: adminAudit.detail, createdAt: adminAudit.createdAt })
    .from(adminAudit)
    .leftJoin(users, eq(users.id, adminAudit.adminId))
    .orderBy(desc(adminAudit.id))
    .limit(limit)
}

export async function targetUser(db: Db, id: number) {
  const [user] = await db.select().from(users).where(eq(users.id, id))
  if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })
  return user
}

export interface UserChanges {
  experimental?: unknown
  admin?: unknown
  disabled?: unknown
}

/** Switches experimental, admin and disabled. An admin can't take their own admin role or disable themselves. Each change is audited. */
export async function updateUser(db: Db, adminId: number, id: number, changes: UserChanges, now = new Date()): Promise<void> {
  const user = await targetUser(db, id)
  const set: Partial<typeof users.$inferInsert> = {}
  if (typeof changes.experimental === 'boolean' && changes.experimental !== user.experimental) set.experimental = changes.experimental
  if (typeof changes.admin === 'boolean' && changes.admin !== (user.role === 'admin')) {
    if (id === adminId) throw createError({ statusCode: 400, statusMessage: "You can't change your own admin role" })
    set.role = changes.admin ? 'admin' : 'user'
  }
  if (typeof changes.disabled === 'boolean' && changes.disabled !== !!user.disabledAt) {
    if (id === adminId) throw createError({ statusCode: 400, statusMessage: "You can't disable yourself" })
    set.disabledAt = changes.disabled ? now : null
  }
  if (!Object.keys(set).length) return
  await db.transaction(async (tx) => {
    // Disabling ends every session right away
    if (set.disabledAt) await tx.delete(sessions).where(eq(sessions.userId, id))
    await tx.update(users).set(set).where(eq(users.id, id))
  })
  for (const [field, value] of Object.entries(set)) {
    await audit(db, adminId, `user.${field === 'disabledAt' ? 'disabled' : field}`, id, { value: field === 'disabledAt' ? !!value : value })
  }
}
