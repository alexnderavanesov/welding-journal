import { describe, expect, it } from 'vitest'

import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import type { WeldRow } from '@/lib/dispatcher-types'

const rows = [
  { id: 1, projectTitle: 'Проект', subtitleCode: '01', line: 'L-1', joint: '1' },
  { id: 2, projectTitle: 'Проект', subtitleCode: '01', line: 'L-1', joint: '2' },
] as WeldRow[]

describe('system document creation plan', () => {
  it('requires review of manual names after regrouping instead of silently replacing or carrying them', () => {
    const base = { type: 'pstoRequest' as const, date: '2026-08-24', rows, settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS, nextNumber: 12 }
    const original = buildSystemDocumentCreationPlan({ ...base, naming: { mode: 'system', customName: '' } }).groups[0]
    const manual = { mode: 'system' as const, customName: 'Ручное', groupModes: { [original.key]: 'custom' as const }, customGroupNames: { [original.key]: 'Ручное' }, customGroupMembers: { [original.key]: original.membership! } }
    const split = buildSystemDocumentCreationPlan({ ...base, naming: { ...manual, splitModes: { pstoRequest: 'joint' } } })
    expect(split.groups.map(group => [group.useSystemName, group.name])).toEqual([[false, ''], [false, '']])
    const changed = buildSystemDocumentCreationPlan({ ...base, rows: rows.slice(0, 1), naming: { ...manual, splitModes: { pstoRequest: 'joint' } } })
    expect(changed.groups[0].name).toBe('')
    const explicit = buildSystemDocumentCreationPlan({ ...base, naming: { ...manual, groupModes: {}, splitModes: { pstoRequest: 'joint' } } })
    expect(explicit.groups.every(group => group.useSystemName)).toBe(true)
  })

  it('retains a manual name across grouping keys if its exact composition stays the same', () => {
    const base = { type: 'pstoRequest' as const, date: '2026-08-24', rows: rows.slice(0, 1), settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS, nextNumber: 12 }
    const original = buildSystemDocumentCreationPlan({ ...base, naming: { mode: 'system', customName: '' } }).groups[0]
    const naming = { mode: 'custom' as const, customName: 'Ручное', customGroupNames: { [original.key]: 'Ручное' }, customGroupMembers: { [original.key]: original.membership! }, splitModes: { pstoRequest: 'joint' as const } }
    expect(buildSystemDocumentCreationPlan({ ...base, naming }).groups[0].name).toBe('Ручное')
  })

  it('reserves preview numbers only for the system-named part of a mixed list', () => {
    const base = { type: 'pstoRequest' as const, date: '2026-08-24', rows, settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS, nextNumber: 12 }
    const naming = { mode: 'system' as const, customName: '', splitModes: { pstoRequest: 'joint' as const } }
    const first = buildSystemDocumentCreationPlan({ ...base, naming }).groups[0]
    const plan = buildSystemDocumentCreationPlan({ ...base, naming: { ...naming, groupModes: { [first.key]: 'custom' }, customGroupNames: { [first.key]: 'Ручное' } } })
    expect(plan.groups[0].name).toBe('Ручное')
    expect(plan.groups[1].name).toMatch(/012$/)
  })
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

  it('uses the independent TVMT naming and split settings', () => {
    const settings = {
      ...REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      tvmtConclusion: {
        defaultMode: 'system' as const,
        systemPattern: 'ТВМТ-Акт-{{№}}',
      },
      splitModes: {
        ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.splitModes,
        tvmtConclusion: 'joint' as const,
      },
    }
    const plan = buildSystemDocumentCreationPlan({
      type: 'lnkConclusion',
      methodCode: 'ТВМТ',
      date: '2026-08-24',
      rows,
      naming: { mode: 'system', customName: '' },
      settings,
      nextNumber: 4,
    })

    expect(plan.groups.map((group) => group.name)).toEqual([
      'ТВМТ-Акт-004',
      'ТВМТ-Акт-005',
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

  it('keeps forced workflow partitions in separate documents', () => {
    const plan = buildSystemDocumentCreationPlan({
      type: 'lnkRequest',
      date: '2026-08-24',
      rows: [
        { ...rows[0], pstoRepeatCycles: [] },
        { ...rows[1], pstoRepeatCycles: [{ id: 5, weldJointId: 2, sequence: 2 }] },
      ],
      naming: { mode: 'system', customName: '' },
      settings: REQUEST_CONCLUSION_DEFAULT_SETTINGS,
      nextNumber: 20,
      partitionBy: (row) => row.pstoRepeatCycles?.length
        ? { key: 'repeat', label: 'Повторный цикл' }
        : { key: 'primary', label: 'Первичный цикл' },
    })

    expect(plan.groups.map((group) => group.label)).toEqual([
      'Все выбранные позиции · Первичный цикл',
      'Все выбранные позиции · Повторный цикл',
    ])
    expect(plan.groups.map((group) => group.name)).toEqual([
      'Заявка-24.08.2026-020',
      'Заявка-24.08.2026-021',
    ])
  })
})
