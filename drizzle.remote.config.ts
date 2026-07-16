import { defineConfig } from 'drizzle-kit'
import { loadServerEnv } from './src/server-env'

loadServerEnv()

const databaseUrl = process.env.DATABASE_URL_REMOTE_FOR_MIGRATIONS

if (!databaseUrl) {
  throw new Error('DATABASE_URL_REMOTE_FOR_MIGRATIONS is not configured')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
})
