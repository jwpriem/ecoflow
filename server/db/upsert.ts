import { sql } from 'drizzle-orm'

/**
 * The `where` for an upsert that only rewrites rows whose values differ. Jobs that refresh a whole
 * window again (prices, irradiance, the last day of the ledgers) would otherwise rewrite every row each run.
 */
export function changed(table: string, columns: string[]) {
  return sql.raw(columns.map((c) => `${table}.${c} is distinct from excluded.${c}`).join(' or '))
}
