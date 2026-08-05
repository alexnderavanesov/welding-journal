import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SECURITY_SETTINGS,
  isSecurityScopeEnabled,
  normalizeSecuritySettings,
  verifySecurityPassword,
} from '@/lib/security-settings'

describe('security settings', () => {
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
