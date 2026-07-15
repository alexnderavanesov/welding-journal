import { defineConfig } from 'drizzle-kit'
import { loadServerEnv } from './src/server-env'

loadServerEnv()

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
