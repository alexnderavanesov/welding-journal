import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useReportPageUiState } from '@/lib/use-report-page-ui-state'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('useReportPageUiState', () => {
  it('keeps the selected documents view while another report is open', () => {
    const { result } = renderHook(() => useReportPageUiState())

    expect(result.current.documentsPageType).toBe('weldingJournal')

    act(() => result.current.setDocumentsPageType('lnkRequest'))

    expect(result.current.documentsPageType).toBe('lnkRequest')
  })

  it('keeps the requested picture tab only for the targeted opening', () => {
    const { result } = renderHook(() => useReportPageUiState())
    const taskRow = { id: 1, joint: 'S1' } as WeldRow
    const regularRow = { id: 2, joint: 'S2' } as WeldRow

    act(() => result.current.openChainPicture(taskRow, {
      initialTab: 'actions',
      focusedTaskKey: 'sp-01:1',
    }))

    expect(result.current.chainRecord).toBe(taskRow)
    expect(result.current.chainPictureIntent).toEqual({
      initialTab: 'actions',
      focusedTaskKey: 'sp-01:1',
    })

    act(() => result.current.setChainRecord(regularRow))

    expect(result.current.chainRecord).toBe(regularRow)
    expect(result.current.chainPictureIntent).toEqual({
      initialTab: 'joint',
      focusedTaskKey: null,
    })
  })
})
