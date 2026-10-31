import { readFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'

/** Counts every server pg.Client.query submission, including transaction SQL.
 * No fixture/observer SQL, query text, parameters or production instrumentation. */
export async function auditSqlCount(rpcUrl?: string) {
  const file = process.env.AUDIT_SQL_COUNTS_FILE
  if (!file) return undefined
  // Allow the server's 500ms telemetry flush after the preceding HTTP response.
  await setTimeout(650)
  const result = JSON.parse(await readFile(file, 'utf8')) as { statements: number; rpcStatements?: Record<string, number> }
  if (!Number.isSafeInteger(result.statements) || result.statements <= 0) throw new Error('SQL audit did not observe the server database connection')
  if (rpcUrl) {
    if (!result.rpcStatements) throw new Error('SQL audit did not enable per-RPC counters')
    return result.rpcStatements[new URL(rpcUrl).pathname.split('/').at(-1)!] ?? 0
  }
  return result.statements
}

/** Optional diagnostics for bounded local measurements, never application data. */
export async function auditSqlDetails() {
  const file = process.env.AUDIT_SQL_COUNTS_FILE
  if (!file) return undefined
  return JSON.parse(await readFile(file, 'utf8')) as {
    statements: number
    dispatcherCalculations: unknown[]
    resources?: { reads: Record<string, { calls: number; rows: number; totalMilliseconds: number }> }
  }
}
