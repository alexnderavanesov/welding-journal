import { createServerOnlyFn } from '@tanstack/react-start'
import type { Permission } from '@/lib/access-permissions'

/** Additional permission determined from locked stored data, not client flags. */
export const assertActionPermission = createServerOnlyFn(async (permission: Permission) => {
  const { requireContextPermission } = await import('./access-payload')
  requireContextPermission(permission)
})
