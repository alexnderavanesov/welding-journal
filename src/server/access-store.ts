import { AsyncLocalStorage } from 'node:async_hooks'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
import type { AuditOriginResolver } from './audit-origin-policy'
export type AccessContext = { identity: AccessIdentity; operationId: string; operation: string; area: string; permissions: Permission[]; documentSaveId?: string; auditOrigin?: AuditOriginResolver; auditWdiSystem?: boolean }
export const accessContext = new AsyncLocalStorage<AccessContext>()
