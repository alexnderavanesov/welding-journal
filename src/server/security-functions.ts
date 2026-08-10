import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'

import type { SecurityScope, SecuritySettings } from '@/lib/security-settings'

const SECURITY_SCOPES: SecurityScope[] = [
  'entry',
  'settings',
  'edit',
  'importReplace',
  'documentGeneration',
  'delete',
]

const getRemoteSecuritySettingsOnServer = createServerOnlyFn(async () => {
  const { getRemoteSecuritySettingsData } = await import('@/server/security')
  return getRemoteSecuritySettingsData()
})

const authenticateSecurityScopeOnServerOnly = createServerOnlyFn(
  async (data: { scope: SecurityScope; password: string }) => {
    const { authenticateSecurityScopeOnServer } = await import('@/server/security')
    return authenticateSecurityScopeOnServer(data)
  },
)

const saveRemoteSecuritySettingsOnServerOnly = createServerOnlyFn(async (data: SecuritySettings) => {
  const { saveRemoteSecuritySettingsOnServer } = await import('@/server/security')
  return saveRemoteSecuritySettingsOnServer(data)
})

export const assertSecurityScope = createServerOnlyFn(async (scope: SecurityScope) => {
  const { assertSecurityScope: assertStoredSecurityScope } = await import('@/server/security')
  await assertStoredSecurityScope(scope)
})

export const getRemoteSecuritySettings = createServerFn({ method: 'GET' }).handler(async () => {
  return getRemoteSecuritySettingsOnServer()
})

export const authenticateSecurityScope = createServerFn({ method: 'POST' })
  .validator((data: { scope: SecurityScope; password: string }) => ({
    scope: requireSecurityScope(data?.scope),
    password: String(data?.password ?? ''),
  }))
  .handler(async ({ data }) => {
    return authenticateSecurityScopeOnServerOnly(data)
  })

export const saveRemoteSecuritySettings = createServerFn({ method: 'POST' })
  .validator((data: SecuritySettings) => data)
  .handler(async ({ data }) => {
    return saveRemoteSecuritySettingsOnServerOnly(data)
  })

function requireSecurityScope(value: unknown): SecurityScope {
  if (!SECURITY_SCOPES.includes(value as SecurityScope)) {
    throw new Error('Неизвестная область защиты')
  }
  return value as SecurityScope
}
