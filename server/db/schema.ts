import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { Locale, Override, StrategyConfig } from '../lib/types'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export type UserRole = 'user' | 'admin'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<UserRole>().notNull().default('user'),
  /** Unlocks the experimental integrations (Zeekr, Tibber app) for the households this user owns */
  experimental: boolean('experimental').notNull().default(false),
  /** Language of the emails to this user */
  locale: text('locale').$type<Locale>().notNull().default('nl'),
  /** Null until the user clicked the link in the verification email; connecting integrations needs it */
  emailVerifiedAt: ts('email_verified_at'),
  /** Set by an admin: the user can't log in, and their sessions were ended */
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
})

/**
 * Single-use links sent by email: a password reset, and later the email check and invites.
 * Only the SHA-256 of the token is stored; the token itself exists only in the email.
 */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AuthTokenKind>().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('auth_tokens_user').on(t.userId)],
)
export type AuthTokenKind = 'reset' | 'verify'

/** What a user accepted and which version of it: the terms at sign-up, the steering disclaimer later. */
export const consents = pgTable(
  'consents',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'terms' | 'steering'>().notNull(),
    version: text('version').notNull(),
    acceptedAt: ts('accepted_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.version] })],
)

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  userAgent: text('user_agent'),
  expiresAt: ts('expires_at').notNull(),
  /** Updated at most every few minutes: when the user was last seen, for the admin panel */
  lastUsedAt: ts('last_used_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
})

/** A household. Everything below hangs off a site; its users are in site_members. */
export const sites = pgTable('sites', {
  id: serial('id').primaryKey(),
  /** The user who created it. Deprecated: read site_members instead. */
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Europe/Amsterdam'),
  strategy: jsonb('strategy').$type<StrategyConfig>().notNull(),
  /** auto = strategy steers the batteries, manual = only monitor */
  controlMode: text('control_mode').$type<'auto' | 'manual'>().notNull().default('auto'),
  override: jsonb('override').$type<Override | null>(),
  createdAt: ts('created_at').notNull().defaultNow(),
})

export type MemberRole = 'owner' | 'member'

/**
 * Who belongs to a household. Access to a site always goes through here; `sites.user_id` is no longer read and
 * will be dropped in a later release. One household per user for now (unique user_id).
 */
export const siteMembers = pgTable(
  'site_members',
  {
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<MemberRole>().notNull().default('member'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.userId] }), uniqueIndex('site_members_user').on(t.userId)],
)

/**
 * An owner's invitation to join their household, sent by email. Single use and valid for 7 days; revoking deletes it.
 * Only the SHA-256 of the token is stored.
 */
export const householdInvites = pgTable(
  'household_invites',
  {
    id: serial('id').primaryKey(),
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: integer('invited_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('household_invites_site').on(t.siteId)],
)

export type Provider = 'tibber' | 'solaredge' | 'ecoflow_official' | 'zeekr' | 'tibber_app'

export const integrations = pgTable(
  'integrations',
  {
    id: serial('id').primaryKey(),
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<Provider>().notNull(),
    /** AES-256-GCM encrypted JSON with the secrets (tokens, keys, passwords) */
    credentialsEnc: text('credentials_enc').notNull(),
    /** Non-secret settings, e.g. the chosen Tibber homeId */
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<'unknown' | 'ok' | 'error'>().notNull().default('unknown'),
    lastOkAt: ts('last_ok_at'),
    lastError: text('last_error'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('integrations_site_provider').on(t.siteId, t.provider)],
)

export const devices = pgTable(
  'devices',
  {
    id: serial('id').primaryKey(),
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    /** ecoflow_official = read and steered through the developer API */
    driver: text('driver').$type<'ecoflow_official'>().notNull().default('ecoflow_official'),
    serial: text('serial').notNull(),
    name: text('name').notNull(),
    model: text('model').notNull().default('STREAM Pro'),
    capacityWh: integer('capacity_wh').notNull().default(1920),
    maxChargeW: integer('max_charge_w').notNull().default(1200),
    maxDischargeW: integer('max_discharge_w').notNull().default(800),
    /** Last known reading (see DeviceState in providers/ecoflow) */
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('devices_site_serial').on(t.siteId, t.serial)],
)

/** Cars read through the Zeekr app API (read-only). State holds the last reading (see VehicleState). */
export const vehicles = pgTable(
  'vehicles',
  {
    id: serial('id').primaryKey(),
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<'zeekr'>().notNull().default('zeekr'),
    vin: text('vin').notNull(),
    name: text('name').notNull(),
    model: text('model'),
    /** Usable battery capacity, kWh; used to estimate how much charging a car still needs */
    capacityKwh: doublePrecision('capacity_kwh'),
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('vehicles_site_vin').on(t.siteId, t.vin)],
)

/** One reading per poll per car. SoC 0-1, chargePowerW + while charging. */
export const vehicleSamples = pgTable(
  'vehicle_samples',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    vehicleId: integer('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    ts: ts('ts').notNull(),
    soc: doublePrecision('soc'),
    rangeKm: doublePrecision('range_km'),
    chargePowerW: doublePrecision('charge_power_w'),
    charging: boolean('charging').notNull().default(false),
    pluggedIn: boolean('plugged_in').notNull().default(false),
    atHome: boolean('at_home').notNull().default(false),
  },
  (t) => [index('vehicle_samples_vehicle_ts').on(t.vehicleId, t.ts)],
)

/** Prices in EUR/kWh per slot. total = what you pay for importing (incl. energy tax + VAT). */
export const prices = pgTable(
  'prices',
  {
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    slotStart: ts('slot_start').notNull(),
    slotMinutes: integer('slot_minutes').notNull().default(15),
    energy: doublePrecision('energy').notNull(),
    tax: doublePrecision('tax').notNull(),
    total: doublePrecision('total').notNull(),
    feedIn: doublePrecision('feed_in').notNull(),
    source: text('source').$type<'tibber'>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.slotStart] })],
)

/** Raw readings, roughly one per minute. Power in W: battery + = charging; grid + = import. */
export const samples = pgTable(
  'samples',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    ts: ts('ts').notNull(),
    kind: text('kind').$type<'battery' | 'grid' | 'solar'>().notNull(),
    powerW: doublePrecision('power_w').notNull(),
    soc: doublePrecision('soc'),
    /** STREAM Pro direct PV input, W */
    pvW: doublePrecision('pv_w'),
  },
  (t) => [index('samples_site_kind_ts').on(t.siteId, t.kind, t.ts), index('samples_device_ts').on(t.deviceId, t.ts)],
)

/** One row per battery per 15-min slot. Money in EUR. */
export const ledger = pgTable(
  'ledger',
  {
    deviceId: integer('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    slotStart: ts('slot_start').notNull(),
    chargedSolarKwh: doublePrecision('charged_solar_kwh').notNull(),
    chargedGridKwh: doublePrecision('charged_grid_kwh').notNull(),
    dischargedKwh: doublePrecision('discharged_kwh').notNull(),
    priceTotal: doublePrecision('price_total').notNull(),
    priceFeedIn: doublePrecision('price_feed_in').notNull(),
    costNaive: doublePrecision('cost_naive').notNull(),
    costOpportunity: doublePrecision('cost_opportunity').notNull(),
    valueDischarged: doublePrecision('value_discharged').notNull(),
    savingNaive: doublePrecision('saving_naive').notNull(),
    savingOpportunity: doublePrecision('saving_opportunity').notNull(),
    lossKwh: doublePrecision('loss_kwh').notNull().default(0),
    socEnd: doublePrecision('soc_end'),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.slotStart] }), index('ledger_site_slot').on(t.siteId, t.slotStart)],
)

/** SolarEdge production per 15-min slot (the API's QUARTER_HOUR average), rewritten while the slot is still settling. */
export const solarProduction = pgTable(
  'solar_production',
  {
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    slotStart: ts('slot_start').notNull(),
    avgW: doublePrecision('avg_w').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.slotStart] })],
)

/** Open-Meteo global horizontal irradiance per 15-min slot, past (to fit) and forecast (to plan). W/m². */
export const irradiance = pgTable(
  'irradiance',
  {
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    slotStart: ts('slot_start').notNull(),
    ghi: doublePrecision('ghi').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.slotStart] })],
)

/** Where the solar of one 15-min slot went and what it was worth. Money in EUR. */
export const solarLedger = pgTable(
  'solar_ledger',
  {
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    slotStart: ts('slot_start').notNull(),
    producedKwh: doublePrecision('produced_kwh').notNull(),
    selfUsedKwh: doublePrecision('self_used_kwh').notNull(),
    exportedKwh: doublePrecision('exported_kwh').notNull(),
    toBatteryKwh: doublePrecision('to_battery_kwh').notNull(),
    priceTotal: doublePrecision('price_total').notNull(),
    priceFeedIn: doublePrecision('price_feed_in').notNull(),
    valueSelfUsed: doublePrecision('value_self_used').notNull(),
    valueExported: doublePrecision('value_exported').notNull(),
    valueToBattery: doublePrecision('value_to_battery').notNull(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.slotStart] })],
)

/** Energy "in stock" per battery with what it cost (weighted average). */
export const batteryPool = pgTable('battery_pool', {
  deviceId: integer('device_id').primaryKey().references(() => devices.id, { onDelete: 'cascade' }),
  kwh: doublePrecision('kwh').notNull(),
  costNaive: doublePrecision('cost_naive').notNull(),
  costOpportunity: doublePrecision('cost_opportunity').notNull(),
  /** Start of the next slot that still has to be booked */
  nextSlot: ts('next_slot').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

export const plans = pgTable(
  'plans',
  {
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    slotStart: ts('slot_start').notNull(),
    action: text('action').$type<'self_use' | 'solar_only' | 'charge_grid' | 'discharge'>().notNull(),
    targetW: integer('target_w'),
    price: doublePrecision('price').notNull(),
    reason: text('reason').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.slotStart] })],
)

export const commandsLog = pgTable(
  'commands_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: integer('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    ts: ts('ts').notNull().defaultNow(),
    command: text('command').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    result: text('result').notNull(),
  },
  (t) => [index('commands_device_ts').on(t.deviceId, t.ts)],
)

export type PushTopic = 'plan' | 'prices' | 'errors' | 'daily' | 'car'

/** One row per browser/phone that allowed notifications (Web Push). */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    /** Who subscribed this device: leaving the household takes their devices out of its notifications */
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    topics: jsonb('topics').$type<PushTopic[]>().notNull().default(['plan', 'prices', 'errors', 'daily']),
    userAgent: text('user_agent'),
    /** Language this device shows notifications in */
    locale: text('locale').$type<Locale>().notNull().default('nl'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastOkAt: ts('last_ok_at'),
  },
  (t) => [index('push_subscriptions_site').on(t.siteId)],
)

/** One row per background job run that did its work (not skipped), for the admin's job health. Kept for 7 days. */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    job: text('job').notNull(),
    startedAt: ts('started_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    sitesOk: integer('sites_ok').notNull(),
    sitesFailed: integer('sites_failed').notNull(),
    sitesTimedOut: integer('sites_timed_out').notNull().default(0),
    /** The first sites that failed or timed out, with the error */
    errors: jsonb('errors').$type<{ siteId: number; error: string }[]>().notNull().default([]),
  },
  (t) => [index('job_runs_job_started').on(t.job, t.startedAt)],
)

/**
 * Who runs a job right now. A runner takes the row when the lease has run out and gives it back when done;
 * a crashed runner's lease simply expires. Keeps two instances from doing the same job at once.
 */
export const jobLocks = pgTable('job_locks', {
  job: text('job').primaryKey(),
  holder: text('holder').notNull(),
  lockedUntil: ts('locked_until').notNull(),
})

/** What admins did to whom: one row per action. The target is kept as a number, so the row outlives the user. */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: serial('id').primaryKey(),
    adminId: integer('admin_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetUserId: integer('target_user_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('admin_audit_created').on(t.createdAt)],
)

/** Server-wide settings that are generated once, e.g. the Web Push (VAPID) key pair. */
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
