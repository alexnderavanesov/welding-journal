import { defineConfig } from 'drizzle-kit'
import { loadServerEnv } from './src/server-env'
import { getDatabaseConnectionConfig } from './src/db/ssl'

loadServerEnv()

const databaseUrl = process.env.DATABASE_URL_REMOTE_FOR_MIGRATIONS

if (!databaseUrl) {
  throw new Error('DATABASE_URL_REMOTE_FOR_MIGRATIONS is not configured')
}


const connectionConfig = getDatabaseConnectionConfig(databaseUrl, process.env.DATABASE_SSL_CA)
const parsedUrl = new URL(connectionConfig.connectionString)
const dbCredentials = connectionConfig.ssl
  ? {
      host: parsedUrl.hostname,
      port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
      user: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
      password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
      database: decodeURIComponent(parsedUrl.pathname.slice(1)),
      ssl: connectionConfig.ssl,
    }
  : { url: connectionConfig.connectionString }

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials,
})
