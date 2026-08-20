import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ActiveReport } from '@/lib/home-state'
import { useReportEditActions } from '@/lib/use-report-edit-actions'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('useReportEditActions control basis navigation', () => {
  it.each<ActiveReport>(['weldingJournal', 'lnk', 'heatTreatment'])(
    'opens the full control assignment editor from %s',
    (activeReport) => {
      const setEditing = vi.fn()
      const row = { id: 1, joint: 'S1', controlBasisSummary: 'РК: ТР №1' } as WeldRow
      const { result } = renderHook(() => useReportEditActions({
        activeReport,
        heatTreatmentFieldEditing: null,
        heatTreatmentFieldMutation: { mutate: vi.fn() },
        lnkFieldMutation: { mutate: vi.fn() },
        lnkRequestOptions: [],
        rows: [row],
        setEditing,
        setHeatTreatmentFieldEditing: vi.fn(),
        setRkExposureEditing: vi.fn(),
        setMessage: vi.fn(),
      }))

      act(() => result.current.handleEditRecord(row, 'controlBasisSummary'))

      expect(setEditing).toHaveBeenCalledWith({
        record: row,
        focusField: 'controlBasisSummary',
        returnPageScrollPosition: undefined,
      })
    },
  )
})
