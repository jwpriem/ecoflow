import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { Db } from '../db/client'
import { appConfig, consents, siteMembers, sites, users } from '../db/schema'
import { TERMS_VERSION } from '../lib/legal'
import { defaultStrategy, type Locale, LOCALES } from '../lib/types'
import { hashPassword } from '../utils/crypto'

export interface AccountOptions {
  siteName?: string
  locale?: Locale
  /** A new public household only monitors until its owner turns steering on */
  controlMode?: 'auto' | 'manual'
}

/** The database, or a transaction on it */
export type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

/** A household of the user's own, which they own. The batteries are added from the EcoFlow account once its developer keys are saved. */
export async function newHousehold(tx: Tx, userId: number, opts: AccountOptions = {}) {
  const [site] = await tx
    .insert(sites)
    .values({ userId, name: opts.siteName ?? 'Home', strategy: defaultStrategy, controlMode: opts.controlMode ?? 'auto' })
    .returning()
  await tx.insert(siteMembers).values({ siteId: site!.id, userId, role: 'owner' })
  return site!
}

/** Create a user with one site, which they own. */
export async function createAccount(db: Db, email: string, password: string, opts: AccountOptions = {}) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: normalizeEmail(email), passwordHash: await hashPassword(password), locale: opts.locale ?? 'nl' })
      .returning()
    return { user: user!, site: await newHousehold(tx, user!.id, opts) }
  })
}

export const normalizeEmail = (email: string) => email.toLowerCase().trim()

export type SignupMode = 'open' | 'closed'
const SIGNUP_MODE = 'signup_mode'

/** Closed until launch: then only an invite gets someone in. The admin panel switches it. */
export async function signupMode(db: Db): Promise<SignupMode> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, SIGNUP_MODE))
  return row?.value === 'open' ? 'open' : 'closed'
}

export async function setSignupMode(db: Db, mode: SignupMode) {
  await db.insert(appConfig).values({ key: SIGNUP_MODE, value: mode }).onConflictDoUpdate({ target: appConfig.key, set: { value: mode } })
}

export interface SignupInput {
  email?: unknown
  password?: unknown
  locale?: unknown
  acceptTerms?: unknown
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * A new account with its own household (monitor only) and the accepted terms.
 * `created: false` when the email already has an account: the caller answers the same either way,
 * so sign-up doesn't reveal which addresses are registered.
 */
export async function signUp(db: Db, input: SignupInput): Promise<{ created: boolean; user: typeof users.$inferSelect; locale: Locale }> {
  const email = typeof input.email === 'string' ? normalizeEmail(input.email) : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const locale: Locale = LOCALES.includes(input.locale as Locale) ? (input.locale as Locale) : 'nl'
  if (!EMAIL.test(email) || password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Email and a password of at least 8 characters are required' })
  }
  if (input.acceptTerms !== true) throw createError({ statusCode: 400, statusMessage: 'Accept the terms to create an account' })
  if ((await signupMode(db)) !== 'open') throw createError({ statusCode: 403, statusMessage: 'Sign-up is closed' })

  const [existing] = await db.select().from(users).where(eq(users.email, email))
  if (existing) {
    // Same work as a new account, so the answer takes as long either way
    await hashPassword(password)
    return { created: false, user: existing, locale }
  }
  const { user } = await createAccount(db, email, password, { locale, controlMode: 'manual' })
  await db.insert(consents).values({ userId: user.id, kind: 'terms', version: TERMS_VERSION })
  return { created: true, user, locale }
}
