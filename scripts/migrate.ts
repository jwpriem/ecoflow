import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from '../server/db/client'

const db = createDb(process.env.NUXT_DATABASE_URL ?? '')
await migrate(db, { migrationsFolder: 'server/db/migrations' })
console.log('migrations applied')
process.exit(0)
