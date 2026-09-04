import { describe, expect, it } from 'vitest'

import { assertExpectedDocumentTemplateVersion } from '@/server/document-templates'

describe('document template concurrent editing', () => {
  const record = { updatedAt: new Date('2026-09-04T10:00:00.000Z') }

  it('accepts a new template only when no template was visible', () => {
    expect(() => assertExpectedDocumentTemplateVersion(undefined, null)).not.toThrow()
    expect(() => assertExpectedDocumentTemplateVersion(record, null)).toThrow('уже изменен другим пользователем')
  })

  it('accepts only the current version of an existing template', () => {
    expect(() => assertExpectedDocumentTemplateVersion(record, '2026-09-04T10:00:00.000Z')).not.toThrow()
    expect(() => assertExpectedDocumentTemplateVersion(record, '2026-09-04T09:59:59.000Z'))
      .toThrow('уже изменен другим пользователем')
    expect(() => assertExpectedDocumentTemplateVersion(undefined, '2026-09-04T10:00:00.000Z'))
      .toThrow('уже изменен другим пользователем')
  })
})
