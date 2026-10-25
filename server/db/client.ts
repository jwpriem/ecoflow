import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDb(url: string) {
  if (!url) throw new Error('NUXT_DATABASE_URL is not set')
  // prepare: false keeps it compatible with Neon's pooled (pgbouncer) endpoint.
  // Every running background job holds one connection for its advisory-lock transaction and needs a
  // second for its own queries (see runJob). Five jobs start together on the hour, so the pool
  // must stay well above 2 x 5 or they all wait on each other and every request times out.
  const client = postgres(url, { prepare: false, max: 20, onnotice: () => {} })
  return drizzle(client, { schema })
}

export type Db = ReturnType<typeof createDb>
export { schema }
