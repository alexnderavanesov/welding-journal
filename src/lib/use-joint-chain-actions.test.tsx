import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { buildJointChainFilters } from '@/lib/report-navigation'
import { useJointChainActions } from '@/lib/use-joint-chain-actions'

function createOptions(activeReport: 'weldingJournal' | 'lnk' | 'heatTreatment' = 'lnk') {
  return {
    activeReport,
    setActiveReport: vi.fn(),
    setChainRecord: vi.fn(),
    setColumnFilters: vi.fn(),
    setHeatTreatmentFilters: vi.fn(),
    setLnkFilters: vi.fn(),
    setMessage: vi.fn(),
  }
}

describe('useJointChainActions', () => {
  it('closes the chain dialog before showing the base chain in the current LNK report', () => {
    const row = {
      id: 17,
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия-1',
      joint: 'F3R1',
    } as WeldRow
    const options = createOptions('lnk')
    const { result } = renderHook(() => useJointChainActions(options))

    act(() => result.current.openChainBaseInCurrentReport(row))

    expect(options.setChainRecord).toHaveBeenCalledWith(null)
    expect(options.setLnkFilters).toHaveBeenCalledWith(buildJointChainFilters(row, 'F3'))
    expect(options.setColumnFilters).not.toHaveBeenCalled()
    expect(options.setMessage).toHaveBeenCalledWith('Показана вся цепочка стыка F3')
  })

  it('shows a dispatcher chain in the report without opening its picture', () => {
    const row = { id: 18, joint: 'F4R1' } as WeldRow
    const options = createOptions('weldingJournal')
    const { result } = renderHook(() => useJointChainActions(options))

    act(() => result.current.showRepeatedJointTaskChain(row, 'F4', 'Показана цепочка'))

    expect(options.setChainRecord).toHaveBeenCalledWith(null)
    expect(options.setColumnFilters).toHaveBeenCalledWith(buildJointChainFilters(row, 'F4'))
  })

  it('opens a dispatcher joint picture without changing report filters', () => {
    const row = { id: 20, joint: 'F6' } as WeldRow
    const task = {
      kind: 'check',
      key: 'check:F6',
      row,
      sourceRow: row,
      sourceJoint: 'F6',
      targetJoint: 'F6',
      baseJoint: 'F6',
      suffix: 'R',
      reason: 'проверить данные',
    } as const
    const options = createOptions('lnk')
    const { result } = renderHook(() => useJointChainActions(options))

    act(() => result.current.openRepeatedJointTaskPicture(task))

    expect(options.setChainRecord).toHaveBeenCalledWith(row)
    expect(options.setColumnFilters).not.toHaveBeenCalled()
    expect(options.setLnkFilters).not.toHaveBeenCalled()
    expect(options.setMessage).toHaveBeenCalledWith('Открыта картина стыка F6')
  })

  it('shows the base chain in the PSTO report when the chain was opened from PSTO', () => {
    const row = {
      id: 19,
      projectTitle: 'Проект',
      subtitleCode: 'Шифр',
      line: 'Линия-1',
      joint: 'F5R2',
    } as WeldRow
    const options = createOptions('heatTreatment')
    const { result } = renderHook(() => useJointChainActions(options))

    act(() => result.current.openChainBaseInCurrentReport(row))

    expect(options.setChainRecord).toHaveBeenCalledWith(null)
    expect(options.setHeatTreatmentFilters).toHaveBeenCalledWith(buildJointChainFilters(row, 'F5'))
    expect(options.setColumnFilters).not.toHaveBeenCalled()
    expect(options.setLnkFilters).not.toHaveBeenCalled()
  })
})
