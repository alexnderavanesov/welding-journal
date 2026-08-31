import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FIELD_BY_KEY, type WeldFieldKey } from '@/lib/weld-fields'
import { JOINT_CHAIN_FILTER_KEY } from '@/lib/report-hidden-filters'
import { useWeldReportViewState } from '@/lib/use-weld-report-view-state'

const sections = [
  {
    section: 'Сварка',
    fields: (['line', 'joint', 'weldDate'] as WeldFieldKey[]).map((key) => FIELD_BY_KEY.get(key)!),
  },
  {
    section: 'Материалы',
    fields: (['material1'] as WeldFieldKey[]).map((key) => FIELD_BY_KEY.get(key)!),
  },
]

describe('useWeldReportViewState', () => {
  beforeEach(() => window.localStorage.clear())

  it('saves and restores columns, filters, sorting and expanded sections as one browser view', () => {
    const onColumnFiltersChange = vi.fn()
    const onSortChange = vi.fn()
    const { result } = renderHook(() => useWeldReportViewState({
      storageKey: 'lnk',
      sections,
      alwaysVisibleFieldKeys: new Set(['line', 'joint']),
      defaultCollapsedSections: new Set(),
      columnFilters: { line: '330-D01' },
      sort: { fieldKey: 'weldDate', direction: 'desc' },
      onColumnFiltersChange,
      onSortChange,
    }))

    act(() => {
      result.current.toggleField('material1')
      result.current.toggleSection('Материалы')
    })
    act(() => expect(result.current.saveView('Моя проверка')).toBe(true))

    const savedView = result.current.savedViews[0]!
    act(() => {
      result.current.showAllFields()
      result.current.toggleSection('Материалы')
      result.current.applySavedView(savedView)
    })

    expect(result.current.hiddenFieldKeys).toEqual(new Set(['material1']))
    expect(result.current.collapsedSections).toEqual(new Set(['Материалы']))
    expect(onColumnFiltersChange).toHaveBeenCalledWith({ line: '330-D01' })
    expect(onSortChange).toHaveBeenCalledWith({ fieldKey: 'weldDate', direction: 'desc' })
  })

  it('does not restore obsolete sections or unknown columns', () => {
    window.localStorage.setItem('welding-report-view:v1:lnk', JSON.stringify({
      activePreset: 'custom',
      hiddenFieldKeys: ['material1', 'missingField'],
      customHiddenFieldKeys: ['material1', 'missingField'],
      collapsedSections: ['Материалы'],
      savedViews: [{
        id: 'view-1',
        name: 'Старый вид',
        snapshot: {
          hiddenFieldKeys: ['material1', 'missingField'],
          collapsedSections: ['Материалы', 'Удаленный раздел'],
          columnFilters: {},
          sort: null,
        },
      }],
    }))
    const { result } = renderHook(() => useWeldReportViewState({
      storageKey: 'lnk',
      sections,
      alwaysVisibleFieldKeys: new Set(['line', 'joint']),
      defaultCollapsedSections: new Set(),
      columnFilters: {},
      sort: null,
      onColumnFiltersChange: vi.fn(),
      onSortChange: vi.fn(),
    }))

    act(() => result.current.applySavedView(result.current.savedViews[0]!))
    expect(result.current.hiddenFieldKeys).toEqual(new Set(['material1']))
    expect(result.current.collapsedSections).toEqual(new Set(['Материалы']))
  })

  it('drops obsolete filters and sorting while preserving supported hidden report filters', () => {
    const onColumnFiltersChange = vi.fn()
    const onSortChange = vi.fn()
    const { result } = renderHook(() => useWeldReportViewState({
      storageKey: 'lnk',
      sections,
      alwaysVisibleFieldKeys: new Set(['line', 'joint']),
      defaultCollapsedSections: new Set(),
      columnFilters: {},
      sort: null,
      onColumnFiltersChange,
      onSortChange,
    }))

    act(() => result.current.applySavedView({
      id: 'legacy-view',
      name: 'Старый вид',
      snapshot: {
        hiddenFieldKeys: [],
        collapsedSections: [],
        columnFilters: {
          line: '111sto',
          missingField: 'невидимый фильтр',
          [JOINT_CHAIN_FILTER_KEY]: '{"baseJoint":"F1","suffixes":["R"]}',
        },
        sort: { fieldKey: 'missingField' as WeldFieldKey, direction: 'asc' },
      },
    }))

    expect(onColumnFiltersChange).toHaveBeenCalledWith({
      line: '111sto',
      [JOINT_CHAIN_FILTER_KEY]: '{"baseJoint":"F1","suffixes":["R"]}',
    })
    expect(onSortChange).toHaveBeenCalledWith(null)
  })
})
