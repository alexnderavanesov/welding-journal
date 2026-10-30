import type { SecurityScope } from '@/lib/security-settings'
import { createServerOnlyFn } from '@tanstack/react-start'

// Concrete permissions are checked by the server operation registry.
export const assertSecurityScope = createServerOnlyFn(async (scope: SecurityScope) => {
  const { requireIdentity } = await import('./access-context')
  await requireIdentity()
  if (scope === 'delete') {
    const { accessContext } = await import('./access-store')
    const context = accessContext.getStore()
    if (context && context.area !== 'access') {
      const { requireContextPermission } = await import('./access-payload')
      requireContextPermission(`${context.area}.delete` as import('@/lib/access-permissions').Permission)
    }
  }
})
