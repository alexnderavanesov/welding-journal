import { AsyncLocalStorage } from 'node:async_hooks'
import type { AccessIdentity, Permission } from '@/lib/access-permissions'
export type AccessContext = { identity: AccessIdentity; operationId: string; operation: string; area: string; permissions: Permission[] }
export const accessContext = new AsyncLocalStorage<AccessContext>()
