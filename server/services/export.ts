import { and, asc, eq, gt, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from '../db/client'
import {
  commandsLog,
  consents,
  devices,
  integrations,
  ledger,
  plans,
  prices,
  pushSubscriptions,
  samples,
  siteMembers,
  sites,
  solarLedger,
  solarProduction,
  users,
  vehicleSamples,
  vehicles,
} from '../db/schema'

export const EXPORT_FORMAT = 'wattswise-export-1'

type Row = Record<string, unknown>

/**
 * A household table, read in pages ordered by `key`, which is unique within what `where` selects. Tables keyed per
 * device (ledger, commands) are read one device at a time. site_id is left out: every row is this household's.
 */
interface Section {
  name: string
  table: PgTable
  key: PgColumn
  where: (siteId: number, deviceId: number) => SQL | undefined
  perDevice?: boolean
}

const SECTIONS: Section[] = [
  { name: 'devices', table: devices, key: devices.id, where: (s) => eq(devices.siteId, s) },
  { name: 'samples', table: samples, key: samples.id, where: (s) => eq(samples.siteId, s) },
  { name: 'ledger', table: ledger, key: ledger.slotStart, where: (s, d) => and(eq(ledger.siteId, s), eq(ledger.deviceId, d)), perDevice: true },
  { name: 'commands', table: commandsLog, key: commandsLog.id, where: (_, d) => eq(commandsLog.deviceId, d), perDevice: true },
  { name: 'prices', table: prices, key: prices.slotStart, where: (s) => eq(prices.siteId, s) },
  { name: 'plans', table: plans, key: plans.slotStart, where: (s) => eq(plans.siteId, s) },
  { name: 'solarProduction', table: solarProduction, key: solarProduction.slotStart, where: (s) => eq(solarProduction.siteId, s) },
  { name: 'solarLedger', table: solarLedger, key: solarLedger.slotStart, where: (s) => eq(solarLedger.siteId, s) },
  { name: 'vehicles', table: vehicles, key: vehicles.id, where: (s) => eq(vehicles.siteId, s) },
  { name: 'vehicleSamples', table: vehicleSamples, key: vehicleSamples.id, where: (s) => eq(vehicleSamples.siteId, s) },
]

/** The parts about a person or a connection: chosen field by field, so a new secret column never slips in. */
async function header(db: Db, userId: number) {
  const [me] = await db
    .select({
      email: users.email,
      locale: users.locale,
      role: users.role,
      experimental: users.experimental,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      household: {
        id: sites.id,
        name: sites.name,
        timezone: sites.timezone,
        strategy: sites.strategy,
        controlMode: sites.controlMode,
        override: sites.override,
        createdAt: sites.createdAt,
      },
      householdRole: siteMembers.role,
    })
    .from(users)
    .innerJoin(siteMembers, eq(siteMembers.userId, users.id))
    .innerJoin(sites, eq(sites.id, siteMembers.siteId))
    .where(eq(users.id, userId))
  if (!me) throw new Error(`user ${userId} has no household`)
  const { household: { id: siteId, ...household }, householdRole, ...profile } = me
  return {
    siteId,
    head: {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      profile,
      consents: await db.select({ kind: consents.kind, version: consents.version, acceptedAt: consents.acceptedAt }).from(consents).where(eq(consents.userId, userId)),
      household: { ...household, yourRole: householdRole },
      // Which services are connected, never their keys or tokens
      connections: await db
        .select({ provider: integrations.provider, status: integrations.status, lastOkAt: integrations.lastOkAt, updatedAt: integrations.updatedAt })
        .from(integrations)
        .where(eq(integrations.siteId, siteId)),
      // This user's own devices with notifications; the endpoint and keys are what lets anyone push to them
      notifications: await db
        .select({ topics: pushSubscriptions.topics, locale: pushSubscriptions.locale, userAgent: pushSubscriptions.userAgent, createdAt: pushSubscriptions.createdAt })
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.siteId, siteId), eq(pushSubscriptions.userId, userId))),
    },
  }
}

async function* rows(db: Db, s: Section, siteId: number, deviceId: number, pageSize: number): AsyncGenerator<Row> {
  const field = keyField(s)
  let last: unknown
  for (;;) {
    const page = (await db
      .select()
      .from(s.table)
      .where(and(s.where(siteId, deviceId), last === undefined ? undefined : gt(s.key, last)))
      .orderBy(asc(s.key))
      .limit(pageSize)) as Row[]
    for (const { siteId: _, ...row } of page) yield row
    if (page.length < pageSize) return
    last = page.at(-1)![field]
  }
}

/** The JS field name of the section's key column (drizzle rows use field names, not column names). */
function keyField(s: Section) {
  const entry = Object.entries(s.table).find(([, c]) => c === s.key)
  if (!entry) throw new Error(`no key field for ${s.name}`)
  return entry[0]
}

/**
 * The user's export as JSON text in chunks: their own profile and the household's data, one page of rows at a time,
 * so a year of samples never sits in memory. A member gets the same household data as the owner.
 */
export async function* exportChunks(db: Db, userId: number, pageSize = 2000): AsyncGenerator<string> {
  const { siteId, head } = await header(db, userId)
  const json = JSON.stringify(head)
  yield json.slice(0, -1)
  const deviceIds = (await db.select({ id: devices.id }).from(devices).where(eq(devices.siteId, siteId)).orderBy(devices.id)).map((d) => d.id)
  for (const s of SECTIONS) {
    yield `,${JSON.stringify(s.name)}:[`
    let first = true
    let buf: string[] = []
    for (const deviceId of s.perDevice ? deviceIds : [0]) {
      for await (const row of rows(db, s, siteId, deviceId, pageSize)) {
        buf.push((first ? '' : ',') + JSON.stringify(row))
        first = false
        if (buf.length >= pageSize) {
          yield buf.join('')
          buf = []
        }
      }
    }
    yield `${buf.join('')}]`
  }
  yield '}'
}
