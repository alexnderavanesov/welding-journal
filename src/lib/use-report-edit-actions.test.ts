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

  it('opens simple defect fields only for rejected primary and pre-TO results', () => {
    const setHeatTreatmentFieldEditing = vi.fn()
    const setMessage = vi.fn()
    const row = {
      id: 1,
      hasVik: 'да',
      hasUzk: 'да',
      vikResult: 'ремонт',
      vikDefectDescription: 'Трещина',
      uzkResult: 'годен',
      uzkDefectDescription: 'ДНО',
      preHeatTreatmentControls: [{
        id: 11,
        weldJointId: 1,
        method: 'ПВК',
        result: 'вырез',
        defectDescription: 'Пора',
      }],
    } as WeldRow
    const { result } = renderHook(() => useReportEditActions({
      activeReport: 'lnk',
      heatTreatmentFieldEditing: null,
      heatTreatmentFieldMutation: { mutate: vi.fn() },
      lnkFieldMutation: { mutate: vi.fn() },
      lnkRequestOptions: [],
      rows: [row],
      setEditing: vi.fn(),
      setHeatTreatmentFieldEditing,
      setRkExposureEditing: vi.fn(),
      setMessage,
    }))

    act(() => result.current.handleEditRecord(row, 'vikDefectDescription'))
    expect(setHeatTreatmentFieldEditing).toHaveBeenLastCalledWith(expect.objectContaining({
      fieldKey: 'vikDefectDescription',
      value: 'Трещина',
    }))

    act(() => result.current.handleEditRecord(row, 'prePvkDefectDescription'))
    expect(setHeatTreatmentFieldEditing).toHaveBeenLastCalledWith(expect.objectContaining({
      fieldKey: 'prePvkDefectDescription',
      value: 'Пора',
    }))

    const callCount = setHeatTreatmentFieldEditing.mock.calls.length
    act(() => result.current.handleEditRecord(row, 'uzkDefectDescription'))
    expect(setHeatTreatmentFieldEditing).toHaveBeenCalledTimes(callCount)
    expect(setMessage).toHaveBeenLastCalledWith(expect.stringContaining('автоматически'))
  })
})
