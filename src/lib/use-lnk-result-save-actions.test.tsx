import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { useLnkResultSaveActions } from '@/lib/use-lnk-result-save-actions'

vi.mock('@/lib/confirm-action-context', () => ({
  useConfirmAction: () => vi.fn(),
}))

vi.mock('@/lib/save-check-settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/save-check-settings')>()
  return {
    ...original,
    useSaveCheckSettings: () => DEFAULT_SAVE_CHECK_SETTINGS,
  }
})

const rows = [
  { id: 1, d1: 108, d2: 108 },
  { id: 2, d1: 108, d2: 108 },
] as WeldRow[]

function createDraft(): LnkResultDraftState {
  return {
    requestName: 'Заявка ВИК-001',
    requestDate: '2026-08-20',
    methodKey: 'vikRequest',
    rowIds: new Set([1, 2]),
    rowResults: {},
    controlDate: '2026-08-27',
    result: 'годен',
    conclusionNaming: { mode: 'system', customName: '', customGroupNames: {} },
    search: '',
  }
}

function useHarness(initialDraft = createDraft(), lnkRows = rows) {
  const [draft, setDraft] = useState(initialDraft)
  const actions = useLnkResultSaveActions({
    lnkRows,
    draft,
    selectedRows: lnkRows,
    saveBlockReason: null,
    nextConclusionName: 'ЗНК-ВИК-001',
    nextConclusionNumber: 1,
    requestConclusionSettings: REQUEST_CONCLUSION_DEFAULT_SETTINGS,
    resultMutation: { mutate: vi.fn() },
    clearGeneratedDataMutation: { mutate: vi.fn() },
    setDraft,
    setMessage: vi.fn(),
  })
  return { draft, ...actions }
}

describe('useLnkResultSaveActions', () => {
  it('changes only the context rows while preserving the shared result for the others', () => {
    const { result } = renderHook(() => useHarness())

    act(() => result.current.setLnkResultForRows([2], 'не годен'))

    expect(result.current.draft.result).toBe('__custom__')
    expect(result.current.draft.rowResults).toEqual({ 1: 'годен', 2: 'не годен' })
  })

  it('does not assign repair when any context row violates the repair rule', () => {
    const forbiddenRows = [rows[0], { ...rows[1], d1: 57, d2: 57 }] as WeldRow[]
    const initialDraft = createDraft()
    const { result } = renderHook(() => useHarness(initialDraft, forbiddenRows))

    act(() => result.current.setLnkResultForRows([1, 2], 'ремонт'))

    expect(result.current.draft).toEqual(initialDraft)
  })
})
