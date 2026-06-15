import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

const pool = connectionString ? new pg.Pool({ connectionString }) : null

export const db = pool ? drizzle(pool, { schema }) : null

export function requireDb() {
  if (!db) throw new Error('DATABASE_URL is not configured')
  return db
}
