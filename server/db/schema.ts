import {
  bigserial,
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
import type { StrategyConfig, Override } from '../lib/types'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  userAgent: text('user_agent'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
})

/** A household. Everything below hangs off a site, so more users/sites can be added later. */
export const sites = pgTable('sites', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Europe/Amsterdam'),
  strategy: jsonb('strategy').$type<StrategyConfig>().notNull(),
  /** auto = strategy steers the batteries, manual = only monitor */
  controlMode: text('control_mode').$type<'auto' | 'manual'>().notNull().default('auto'),
  override: jsonb('override').$type<Override | null>(),
  createdAt: ts('created_at').notNull().defaultNow(),
})

export type Provider = 'tibber' | 'solaredge' | 'ecoflow_app' | 'ecoflow_official'

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

export const devices = pgTable('devices', {
  id: serial('id').primaryKey(),
  siteId: integer('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  /** mock = simulated battery; ecoflow_app / ecoflow_official = real device */
  driver: text('driver').$type<'mock' | 'ecoflow_app' | 'ecoflow_official'>().notNull().default('mock'),
  serial: text('serial').notNull(),
  name: text('name').notNull(),
  model: text('model').notNull().default('STREAM Pro'),
  capacityWh: integer('capacity_wh').notNull().default(1920),
  maxChargeW: integer('max_charge_w').notNull().default(1200),
  maxDischargeW: integer('max_discharge_w').notNull().default(800),
  /** Last known reading / simulator state */
  state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
})

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
    source: text('source').$type<'tibber' | 'fake'>().notNull(),
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
