import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { loadServerEnv } from '@/server-env'
import * as schema from './schema'

loadServerEnv()

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured')
}

const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX)
const pool = new pg.Pool({
  connectionString,
  max: Number.isInteger(configuredPoolMax) && configuredPoolMax > 0 ? configuredPoolMax : 5,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  allowExitOnIdle: true,
})

export const db = drizzle(pool, { schema })

export function requireDb() {
  return db
}
