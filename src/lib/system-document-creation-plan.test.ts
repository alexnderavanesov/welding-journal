import { describe, expect, it } from 'vitest'

import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import type { WeldRow } from '@/lib/dispatcher-types'

const rows = [
  { id: 1, projectTitle: 'Проект', subtitleCode: '01', line: 'L-1', joint: '1' },
  { id: 2, projectTitle: 'Проект', subtitleCode: '01', line: 'L-1', joint: '2' },
] as WeldRow[]

describe('system document creation plan', () => {
  it('preserves one document when splitting is disabled', () => {
    const plan = buildSystemDocumentCreationPlan({
      type: 'lnkRequest',
      date: '2026-08-24',
      rows,
      naming: { mode: 'system', customName: '' },
      settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      nextNumber: 7,
    })

    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].name).toBe('Заявка-24.08.2026-007')
  })

  it('allocates a different preview number for every split document', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
        lnkConclusionRk: 'joint' as const,
      },
    }
    const plan = buildSystemDocumentCreationPlan({
      type: 'lnkConclusion',
      methodCode: 'РК',
      date: '2026-08-24',
      rows,
      naming: { mode: 'system', customName: '' },
      settings,
      nextNumber: 12,
    })

    expect(plan.groups.map((group) => group.name)).toEqual([
      'ЗНК-РК-24.08.2026-012',
      'ЗНК-РК-24.08.2026-013',
    ])
  })

  it('requires unique manual names for every group', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
        pstoRequest: 'joint' as const,
      },
    }
    const initial = buildSystemDocumentCreationPlan({
      type: 'pstoRequest',
      date: '2026-08-24',
      rows,
      naming: { mode: 'custom', customName: 'Одно имя для серии' },
      settings,
    })
    expect(initial.groups.map((group) => group.name)).toEqual(['', ''])
    expect(initial.error).toBe('Укажите название для каждого создаваемого документа.')

    const duplicateNames = Object.fromEntries(initial.groups.map((group) => [group.key, 'Одинаковое имя']))
    const plan = buildSystemDocumentCreationPlan({
      type: 'pstoRequest',
      date: '2026-08-24',
      rows,
      naming: {
        mode: 'custom',
        customName: '',
        customGroupNames: duplicateNames,
      },
      settings,
    })

    expect(plan.error).toBe('Названия создаваемых документов должны различаться.')
  })

  it('preserves optional results without a conclusion while rejecting a partial series', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      splitModes: {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
        lnkConclusionRk: 'joint' as const,
      },
    }
    const emptyPlan = buildSystemDocumentCreationPlan({
      type: 'lnkConclusion',
      methodCode: 'РК',
      date: '2026-08-24',
      rows,
      naming: { mode: 'custom', customName: '' },
      settings,
      allowAllNamesEmpty: true,
    })
    const partialPlan = buildSystemDocumentCreationPlan({
      type: 'lnkConclusion',
      methodCode: 'РК',
      date: '2026-08-24',
      rows,
      naming: {
        mode: 'custom',
        customName: '',
        customGroupNames: { [emptyPlan.groups[0].key]: 'Только одно имя' },
      },
      settings,
      allowAllNamesEmpty: true,
    })

    expect(emptyPlan.error).toBe('')
    expect(partialPlan.error).toBe('Укажите название для каждого создаваемого документа.')
  })

  it('blocks creation when a required split field is missing', () => {
    const plan = buildSystemDocumentCreationPlan({
      type: 'pstoRequest',
      date: '2026-08-24',
      rows: [{ ...rows[0], line: '' }],
      naming: { mode: 'system', customName: '' },
      settings: {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
        splitModes: {
          ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
          pstoRequest: 'line',
        },
      },
      nextNumber: 1,
    })

    expect(plan.missingSummary).toContain('не заполнено: линия')
    expect(plan.error).toBe('Заполните поля, необходимые для выбранного разделения.')
  })
})
