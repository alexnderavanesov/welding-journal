import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { loadServerEnv } from '@/server-env'
import * as schema from './schema'

loadServerEnv()

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured')
}

const pool = new pg.Pool({ connectionString })

export const db = drizzle(pool, { schema })

export function requireDb() {
  return db
}
