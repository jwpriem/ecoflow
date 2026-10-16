import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDb(url: string) {
  if (!url) throw new Error('NUXT_DATABASE_URL is not set')
  // prepare: false keeps it compatible with Neon's pooled (pgbouncer) endpoint
  const client = postgres(url, { prepare: false, max: 5, onnotice: () => {} })
  return drizzle(client, { schema })
}

export type Db = ReturnType<typeof createDb>
export { schema }
