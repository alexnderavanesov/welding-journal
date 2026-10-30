import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

type Database = NodePgDatabase<typeof schema>
let databasePool: import('pg').Pool | undefined

const shouldInitializeDatabase = import.meta.env?.SSR ?? typeof window === 'undefined'

export const db = (shouldInitializeDatabase ? await createDatabase() : undefined) as Database

export function requireDb() {
  if (!db) throw new Error('Database is only available on the server')
  return db
}

/** Explicit lifecycle cleanup for isolated local runners. */
export async function closeDatabase() { await databasePool?.end() }

async function createDatabase(): Promise<Database> {
  const [drizzleModule, pgModule, serverEnvModule, sslModule] = await Promise.all([
    import('drizzle-orm/node-postgres'),
    import('pg'),
    import('@/server-env'),
    import('./ssl'),
  ])
  serverEnvModule.loadServerEnv()

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not configured')

  const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX)
  const pool = new pgModule.default.Pool({
    ...sslModule.getDatabaseConnectionConfig(connectionString, process.env.DATABASE_SSL_CA),
    max: Number.isInteger(configuredPoolMax) && configuredPoolMax > 0 ? configuredPoolMax : 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  })
  databasePool = pool
  const { withAuditedTransactions } = await import('@/server/audited-database')
  return withAuditedTransactions(drizzleModule.drizzle(pool, { schema }))
}
