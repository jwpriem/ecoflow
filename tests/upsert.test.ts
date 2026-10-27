import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../server/db/schema'
import { changed } from '../server/db/upsert'

const db = drizzle.mock({ schema })

describe('changed', () => {
  it('only rewrites a row whose values differ', () => {
    const q = db
      .insert(schema.irradiance)
      .values({ siteId: 1, slotStart: new Date(), ghi: 1 })
      .onConflictDoUpdate({ target: [schema.irradiance.siteId, schema.irradiance.slotStart], set: { ghi: sql.raw('excluded.ghi') }, setWhere: changed('irradiance', ['ghi']) })
      .toSQL().sql
    expect(q).toMatch(/do update set "ghi" = excluded\.ghi where irradiance\.ghi is distinct from excluded\.ghi$/)
  })

  it('joins several columns with or', () => {
    expect(db.select({ x: sql`1` }).from(schema.prices).where(changed('prices', ['total', 'feed_in'])).toSQL().sql).toContain(
      'prices.total is distinct from excluded.total or prices.feed_in is distinct from excluded.feed_in',
    )
  })
})
