import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDb(url: string) {
  if (!url) throw new Error('NUXT_DATABASE_URL is not set')
  // prepare: false keeps it compatible with Neon's pooled (pgbouncer) endpoint.
  // On the hour five jobs start together, each working on up to 8 households at once (NUXT_JOBS_CONCURRENCY),
  // and requests come in on top: 20 connections leave room for all of it, the rest waits its turn.
  const client = postgres(url, { prepare: false, max: 20, onnotice: () => {} })
  return drizzle(client, { schema })
}

export type Db = ReturnType<typeof createDb>
export { schema }
