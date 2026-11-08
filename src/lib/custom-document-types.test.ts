import { describe, expect, it } from 'vitest'
import { normalizeCustomDocumentNames, validateCustomDocumentNames } from './custom-document-types'
import { buildDocumentTemplateName, createDefaultDocumentTemplateNameConfig } from './document-template-name'
import { buildWeldingJournalGenerationPlan } from './welding-journal-generation'
import { DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS } from './document-template-model'
import { getOperationPermissions } from '@/server/access-operation-policy'
import { SYSTEM_FIELD_KEYS } from '@/server/weld-mutation-policy'
import { projectSettingAffectsDerivedCalculations, projectSettingAffectsDispatcherIndex } from './project-settings-remote'

describe('custom document names', () => {
  it('keeps stable slots, normalizes whitespace and rejects ambiguous or empty names', () => {
    expect(normalizeCustomDocumentNames(null)).toEqual({ custom1: 'Пользовательский 1', custom2: 'Пользовательский 2' })
    expect(validateCustomDocumentNames({ custom1: '  Список   сварщиков ', custom2: 'Контроль' }).custom1).toBe('Список сварщиков')
    expect(() => validateCustomDocumentNames({ custom1: '', custom2: 'Контроль' })).toThrow()
    expect(() => validateCustomDocumentNames({ custom1: 'Контроль', custom2: 'контроль' })).toThrow('различаться')
  })

  it('uses the latest label with a saved default formula, while leaving an explicitly authored title alone', () => {
    const config = createDefaultDocumentTemplateNameConfig('custom1')
    const input = { templateId: 'custom1', config, records: [{ subtitleCode: 'P1' }], periodFrom: '2026-11-01', periodTo: '2026-11-02' }
    const oldTitle = buildDocumentTemplateName({ ...input, documentLabel: 'Сварщики' })
    expect(oldTitle).toBe('Сварщики - P1 - 01.11.26 - 02.11.26')
    expect(buildDocumentTemplateName({ ...input, documentLabel: 'Исполнители' })).toBe('Исполнители - P1 - 01.11.26 - 02.11.26')
    expect(buildDocumentTemplateName({ ...input, documentLabel: 'Исполнители', config: { parts: [{ type: 'text', text: 'Моя форма' }] } })).toBe('Моя форма')
    const plan = buildWeldingJournalGenerationPlan({ type: 'custom2', documentLabel: 'Участники', rows: [{ id: 1, subtitleCode: 'P1' }], template: null, options: DEFAULT_WELDING_JOURNAL_TEMPLATE_OPTIONS, periodFrom: '2026-11-01', periodTo: '2026-11-02' })
    expect(plan.titles).toEqual(['Участники - P1 - 01.11.26 - 02.11.26'])
  })

  it('uses template edit permission without invalidating weld calculations or making document links editable', () => {
    expect(getOperationPermissions('@settingEdit', { key: 'custom-document-names' })).toEqual(['templates.edit'])
    expect(projectSettingAffectsDispatcherIndex('custom-document-names')).toBe(false)
    expect(projectSettingAffectsDerivedCalculations('custom-document-names')).toBe(false)
    expect(SYSTEM_FIELD_KEYS.has('custom1Document')).toBe(true)
    expect(SYSTEM_FIELD_KEYS.has('custom2Document')).toBe(true)
  })
})
