import { createServerOnlyFn } from '@tanstack/react-start'
/** Shared server-function modules must not evaluate Node/DB imports in the browser. */
export const auditSql: typeof import('./audited-database').auditSql = createServerOnlyFn(async (tx, scopes, run) => {
  const server = await import('./audited-database')
  return server.auditSql(tx, scopes, run)
})
export const auditInsertedSql: typeof import('./audited-database').auditInsertedSql = createServerOnlyFn(async (tx, table, run) => {
  const server = await import('./audited-database')
  return server.auditInsertedSql(tx, table, run)
})
