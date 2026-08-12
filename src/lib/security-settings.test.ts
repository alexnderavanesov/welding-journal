import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SECURITY_SETTINGS,
  SERVER_SECURITY_PASSWORD_PLACEHOLDER,
  isSecurityScopeEnabled,
  hasMigratableLocalSecurityPasswords,
  normalizeSecuritySettings,
  verifySecurityPassword,
  toLocalSecuritySettings,
} from '@/lib/security-settings'
import { DATA_IMPORT_SECURITY_SCOPE } from '@/lib/security-scopes'

describe('security settings', () => {
  it('keeps the existing import password scope for every import action', () => {
    const settings = normalizeSecuritySettings({
      importReplacePassword: 'import',
      protectImportReplace: true,
    })

    expect(DATA_IMPORT_SECURITY_SCOPE).toBe('importReplace')
    expect(isSecurityScopeEnabled(settings, DATA_IMPORT_SECURITY_SCOPE)).toBe(true)
    expect(verifySecurityPassword(settings, DATA_IMPORT_SECURITY_SCOPE, 'import')).toBe(true)
  })

  it('keeps document generation protection disabled for legacy settings', () => {
    const settings = normalizeSecuritySettings({
      editPassword: 'edit',
      protectEdit: true,
    })

    expect(settings.documentGenerationPassword).toBe('')
    expect(settings.protectDocumentGeneration).toBe(false)
    expect(isSecurityScopeEnabled(settings, 'documentGeneration')).toBe(false)
  })

  it('enables the document generation scope only with a configured password', () => {
    const settings = normalizeSecuritySettings({
      documentGenerationPassword: 'docs',
      protectDocumentGeneration: true,
    })

    expect(isSecurityScopeEnabled(settings, 'documentGeneration')).toBe(true)
    expect(verifySecurityPassword(settings, 'documentGeneration', 'docs')).toBe(true)
    expect(verifySecurityPassword(settings, 'documentGeneration', 'wrong')).toBe(false)
  })

  it('does not enable document generation protection without a password', () => {
    const settings = normalizeSecuritySettings({
      protectDocumentGeneration: true,
    })

    expect(settings).toEqual(DEFAULT_SECURITY_SETTINGS)
    expect(isSecurityScopeEnabled(settings, 'documentGeneration')).toBe(false)
  })
})

describe('toLocalSecuritySettings', () => {
  it('keeps only server placeholders in browser storage', () => {
    expect(
      toLocalSecuritySettings({
        configured: true,
        configuredScopes: {
          entry: false,
          settings: true,
          edit: true,
          importReplace: false,
          documentGeneration: false,
          delete: true,
        },
        entry: false,
        settings: true,
        edit: false,
        importReplace: false,
        documentGeneration: false,
        delete: true,
      }),
    ).toMatchObject({
      entryPassword: '',
      settingsPassword: SERVER_SECURITY_PASSWORD_PLACEHOLDER,
      editPassword: SERVER_SECURITY_PASSWORD_PLACEHOLDER,
      deletePassword: SERVER_SECURITY_PASSWORD_PLACEHOLDER,
      protectSettings: true,
      protectEdit: false,
      protectDelete: true,
    })
  })
})

describe('legacy security migration', () => {
  it('migrates real browser passwords but never the server placeholder', () => {
    expect(hasMigratableLocalSecurityPasswords({
      ...DEFAULT_SECURITY_SETTINGS,
      settingsPassword: 'legacy-password',
    })).toBe(true)
    expect(hasMigratableLocalSecurityPasswords({
      ...DEFAULT_SECURITY_SETTINGS,
      settingsPassword: SERVER_SECURITY_PASSWORD_PLACEHOLDER,
    })).toBe(false)
  })
})
