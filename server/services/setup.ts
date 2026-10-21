import type { Db } from '../db/client'
import { sites, users } from '../db/schema'
import { defaultStrategy } from '../lib/types'
import { hashPassword } from '../utils/crypto'

/** Create a user with one site. The batteries are added from the EcoFlow account once its developer keys are saved. */
export async function createAccount(db: Db, email: string, password: string, siteName = 'Home') {
  const [user] = await db.insert(users).values({ email: email.toLowerCase().trim(), passwordHash: await hashPassword(password) }).returning()
  const [site] = await db.insert(sites).values({ userId: user!.id, name: siteName, strategy: defaultStrategy }).returning()
  return { user: user!, site: site! }
}
