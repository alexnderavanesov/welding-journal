import { beforeEach, describe, expect, it } from 'vitest'

import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import {
  createSavedWeldReportView,
  getPresetHiddenFieldKeys,
  readWeldReportViewStorage,
  writeWeldReportViewStorage,
} from '@/lib/weld-report-view'

const sections = [{
  section: 'Проверка',
  fields: (['line', 'joint', 'weldDate', 'pstoRequest', 'tvmtConclusion', 'material1'] as WeldFieldKey[])
    .map((key) => FIELD_BY_KEY.get(key)!),
}]

describe('weld report views', () => {
  beforeEach(() => window.localStorage.clear())

  it('builds predictable compact and PSTO/TVMT column sets', () => {
    const alwaysVisible = new Set(['line', 'joint'])
    const compact = getPresetHiddenFieldKeys({
      preset: 'compact',
      sections,
      alwaysVisibleFieldKeys: alwaysVisible,
      customHiddenFieldKeys: new Set(),
    })
    const psto = getPresetHiddenFieldKeys({
      preset: 'pstoTvmt',
      sections,
      alwaysVisibleFieldKeys: alwaysVisible,
      customHiddenFieldKeys: new Set(),
    })

    expect(compact).toEqual(new Set(['weldDate', 'pstoRequest', 'tvmtConclusion', 'material1']))
    expect(psto).toEqual(new Set(['weldDate', 'material1']))
  })

  it('stores named views with filters, sorting and collapsed sections in this browser', () => {
    const view = createSavedWeldReportView('Просроченные ТВМТ', {
      hiddenFieldKeys: ['material1'],
      collapsedSections: ['Материалы'],
      columnFilters: { line: '330-D01', joint: '   ' },
      sort: { fieldKey: 'weldDate', direction: 'desc' },
    }, 'view-1')
    writeWeldReportViewStorage('lnk', {
      activePreset: 'custom',
      hiddenFieldKeys: ['material1'],
      customHiddenFieldKeys: ['material1'],
      collapsedSections: ['Материалы'],
      savedViews: [view],
    })

    const stored = readWeldReportViewStorage('lnk', new Set())
    expect(stored.savedViews[0]).toMatchObject({
      id: 'view-1',
      name: 'Просроченные ТВМТ',
      snapshot: {
        columnFilters: { line: '330-D01' },
        sort: { fieldKey: 'weldDate', direction: 'desc' },
      },
    })
  })

  it('migrates the former status field key in saved browser views', () => {
    window.localStorage.setItem('welding-report-view:v1:lnk', JSON.stringify({
      activePreset: 'custom',
      hiddenFieldKeys: ['status'],
      customHiddenFieldKeys: ['status'],
      collapsedSections: ['Статус'],
      savedViews: [{
        id: 'legacy-view',
        name: 'Старый вид',
        snapshot: {
          hiddenFieldKeys: ['status'],
          collapsedSections: ['Статус'],
          columnFilters: { status: 'неофициальный' },
          sort: { fieldKey: 'status', direction: 'asc' },
        },
      }],
    }))

    expect(readWeldReportViewStorage('lnk', new Set())).toMatchObject({
      hiddenFieldKeys: ['officiality'],
      customHiddenFieldKeys: ['officiality'],
      savedViews: [{
        snapshot: {
          hiddenFieldKeys: ['officiality'],
          columnFilters: { officiality: 'неофициальный' },
          sort: { fieldKey: 'officiality', direction: 'asc' },
        },
      }],
    })
  })
})
