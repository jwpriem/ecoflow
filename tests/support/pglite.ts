import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type { Db } from '../../server/db/client'
import * as schema from '../../server/db/schema'

const dir = 'server/db/migrations'

/** Migration tags in the order they run. */
export const migrationTags = (JSON.parse(readFileSync(`${dir}/meta/_journal.json`, 'utf8')) as { entries: { tag: string }[] }).entries.map((e) => e.tag)

/** Apply the real migration files in order. PGlite has no pg_stat_statements, so extensions are skipped. */
export async function migrate(pg: PGlite, tags = migrationTags) {
  for (const tag of tags) {
    for (const stmt of readFileSync(`${dir}/${tag}.sql`, 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim() && !/CREATE EXTENSION/i.test(stmt)) await pg.exec(stmt)
    }
  }
}

/** Drizzle on an in-process Postgres. Typed as the app's Db: the queries are the same. */
export const pgliteDb = (pg: PGlite) => drizzle(pg, { schema }) as unknown as Db

/** A fresh, fully migrated database. */
export async function freshDb() {
  const pg = new PGlite()
  await migrate(pg)
  return pgliteDb(pg)
}
