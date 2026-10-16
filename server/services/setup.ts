import type { Db } from '../db/client'
import { devices, sites, users } from '../db/schema'
import { defaultStrategy } from '../lib/types'
import { hashPassword } from '../utils/crypto'

/** Create a user with one site and two simulated STREAM Pro batteries (1920 Wh each). */
export async function createAccount(db: Db, email: string, password: string, siteName = 'Home') {
  const [user] = await db.insert(users).values({ email: email.toLowerCase().trim(), passwordHash: await hashPassword(password) }).returning()
  const [site] = await db.insert(sites).values({ userId: user!.id, name: siteName, strategy: defaultStrategy }).returning()
  await db.insert(devices).values([
    { siteId: site!.id, driver: 'mock', serial: 'SIM-STREAM-PRO-1', name: 'STREAM Pro 1' },
    { siteId: site!.id, driver: 'mock', serial: 'SIM-STREAM-PRO-2', name: 'STREAM Pro 2' },
  ])
  return { user: user!, site: site! }
}
