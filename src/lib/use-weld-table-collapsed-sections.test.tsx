import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getCollapsibleExtraSectionNames,
  getVisibleWeldTableExtraColumns,
  type WeldTableExtraColumn,
} from '@/lib/weld-table-extra-columns'
import { useWeldTableCollapsedSections } from '@/lib/use-weld-table-collapsed-sections'

const duplicateControlColumn: WeldTableExtraColumn = {
  key: 'duplicateControl',
  section: 'Дубль контроль',
  label: 'Результаты дубля',
  width: 260,
  collapsible: true,
  renderCell: () => null,
}

describe('collapsible extra weld table sections', () => {
  beforeEach(() => window.localStorage.clear())

  it('hides and restores the duplicate-control column through the shared section state', async () => {
    const extraColumns = [duplicateControlColumn]
    const { result } = renderHook(() =>
      useWeldTableCollapsedSections({
        storageKey: 'lnk-extra-section-test',
        availableSections: [],
        alwaysVisibleFieldKeys: new Set(),
        collapsibleExtraSections: getCollapsibleExtraSectionNames(extraColumns),
      }),
    )

    act(() => result.current.toggleSection('Дубль контроль'))

    expect(result.current.collapsedSections.has('Дубль контроль')).toBe(true)
    expect(getVisibleWeldTableExtraColumns(extraColumns, result.current.collapsedSections)).toEqual([])
    await waitFor(() => {
      expect(window.localStorage.getItem('welding-tracker-collapsed-sections:lnk-extra-section-test'))
        .toContain('Дубль контроль')
    })

    act(() => result.current.toggleSection('Дубль контроль'))

    expect(result.current.collapsedSections.has('Дубль контроль')).toBe(false)
    expect(getVisibleWeldTableExtraColumns(extraColumns, result.current.collapsedSections)).toEqual(extraColumns)
  })
})
