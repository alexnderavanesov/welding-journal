import { createServerOnlyFn } from '@tanstack/react-start'
import type { SecurityScope } from '@/lib/security-settings'
export const assertSecurityScope = createServerOnlyFn(async (scope: SecurityScope) => {
  await (await import('./security')).assertSecurityScope(scope)
})
