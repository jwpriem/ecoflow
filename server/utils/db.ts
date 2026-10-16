import { createDb, type Db } from '../db/client'

let db: Db | undefined

export function useDb(): Db {
  if (!db) db = createDb(useRuntimeConfig().databaseUrl || process.env.NUXT_DATABASE_URL || '')
  return db
}
