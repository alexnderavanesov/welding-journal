import { createServerOnlyFn } from '@tanstack/react-start'
import { accessContext } from './access-store'
export const recordAuditWdiMode = createServerOnlyFn((system: boolean) => {
  const audit = accessContext.getStore()
  if (audit?.auditOrigin) audit.auditWdiSystem = system
})
/** Shared server-function modules must not evaluate Node/DB imports in the browser. */
export const auditSql: typeof import('./audited-database').auditSql = createServerOnlyFn(async (tx, scopes, run) => {
  const server = await import('./audited-database')
  return server.auditSql(tx, scopes, run)
})
export const auditInsertedSql: typeof import('./audited-database').auditInsertedSql = createServerOnlyFn(async (tx, table, run) => {
  const server = await import('./audited-database')
  return server.auditInsertedSql(tx, table, run)
})
