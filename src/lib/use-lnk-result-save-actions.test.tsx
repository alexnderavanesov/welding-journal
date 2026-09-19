import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ControlProcessSettings } from '@/lib/control-process-settings'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import type { LnkResultDraftState } from '@/lib/report-draft-state'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { useLnkResultSaveActions } from '@/lib/use-lnk-result-save-actions'

const { confirmAction } = vi.hoisted(() => ({ confirmAction: vi.fn() }))

type LnkResultMutate = Parameters<
  typeof useLnkResultSaveActions
>[0]['resultMutation']['mutate']

vi.mock('@/lib/confirm-action-context', () => ({
  useConfirmAction: () => confirmAction,
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

function useHarness(
  initialDraft = createDraft(),
  lnkRows = rows,
  options: {
    controlProcessSettings?: ControlProcessSettings
    mutate?: LnkResultMutate
  } = {},
) {
  const [draft, setDraft] = useState(initialDraft)
  const actions = useLnkResultSaveActions({
    controlProcessSettings: options.controlProcessSettings ?? DEFAULT_CONTROL_PROCESS_SETTINGS,
    lnkRows,
    draft,
    selectedRows: lnkRows,
    saveBlockReason: null,
    nextConclusionName: 'ЗНК-ВИК-001',
    nextConclusionNumber: 1,
    requestConclusionSettings: REQUEST_CONCLUSION_DEFAULT_SETTINGS,
    resultMutation: { mutate: options.mutate ?? vi.fn<LnkResultMutate>() },
    setDraft,
    setMessage: vi.fn(),
  })
  return { draft, ...actions }
}

describe('useLnkResultSaveActions', () => {
  beforeEach(() => {
    confirmAction.mockReset()
    confirmAction.mockResolvedValue(true)
  })

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

  it('clears an early primary result without asking to confirm chronology debt', async () => {
    const earlyRow = {
      id: 1,
      d1: 108,
      d2: 108,
      pstoRequired: 'да',
      hasVik: 'да',
    } as WeldRow
    const draft = {
      ...createDraft(),
      rowIds: new Set([earlyRow.id]),
      result: LNK_EMPTY_RESULT_VALUE,
    }
    const mutate = vi.fn<LnkResultMutate>()
    const permissiveSettings = {
      ...DEFAULT_CONTROL_PROCESS_SETTINGS,
      allowPrimaryLnkBeforePreviousStagesComplete: true,
    }
    const { result } = renderHook(() =>
      useHarness(draft, [earlyRow], {
        controlProcessSettings: permissiveSettings,
        mutate,
      }),
    )

    await act(async () => result.current.handleAddLnkResult())

    expect(confirmAction).not.toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledOnce()
  })
})
