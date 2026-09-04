import { defineConfig } from 'drizzle-kit'
import { loadServerEnv } from './src/server-env'
import { assertLocalMigrationDatabaseUrl } from './src/lib/migration-branch-guard'

loadServerEnv()

const databaseUrl = process.env.DATABASE_URL
assertLocalMigrationDatabaseUrl(databaseUrl)

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl!,
  },
})
