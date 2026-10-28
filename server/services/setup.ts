import type { Db } from '../db/client'
import { siteMembers, sites, users } from '../db/schema'
import { defaultStrategy } from '../lib/types'
import { hashPassword } from '../utils/crypto'

/** Create a user with one site, which they own. The batteries are added from the EcoFlow account once its developer keys are saved. */
export async function createAccount(db: Db, email: string, password: string, siteName = 'Home') {
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email: email.toLowerCase().trim(), passwordHash: await hashPassword(password) }).returning()
    const [site] = await tx.insert(sites).values({ userId: user!.id, name: siteName, strategy: defaultStrategy }).returning()
    await tx.insert(siteMembers).values({ siteId: site!.id, userId: user!.id, role: 'owner' })
    return { user: user!, site: site! }
  })
}
