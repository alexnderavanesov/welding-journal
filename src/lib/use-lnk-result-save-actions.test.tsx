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
    layeredControlRowIds: new Set(),
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
    selectedRows: lnkRows.filter((row) => draft.rowIds.has(row.id)),
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

  const mixedRows = [
    { id: 1, joint: 'U1', connectionType: 'У19', hasPvk: 'да', vikResult: 'годен' },
    { id: 2, joint: 'U2', connectionType: 'У19', hasPvk: 'да', vikResult: 'годен' },
    { id: 3, joint: 'C3', connectionType: 'С17', hasPvk: 'да', vikResult: 'годен' },
    { id: 4, joint: 'U4', connectionType: 'У19', hasPvk: 'да', vikResult: 'годен', layeredControlAssigned: true },
  ] as WeldRow[]
  const pvkDraft = () => ({ ...createDraft(), methodKey: 'pvkRequest' as const, rowIds: new Set([1, 2, 3, 4]) })

  it('allows saving again after cancelling layered-control confirmation', async () => {
    confirmAction.mockResolvedValueOnce(false)
    const mutate = vi.fn<LnkResultMutate>()
    const { result } = renderHook(() => useHarness(pvkDraft(), mixedRows, { mutate }))
    act(() => result.current.setLnkResultLayeredControl(1, true))
    await act(async () => result.current.handleAddLnkResult())
    expect(mutate).not.toHaveBeenCalled()
    await act(async () => result.current.handleAddLnkResult())
    expect(confirmAction).toHaveBeenCalledTimes(2)
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('blocks repeated submission during confirmation and mutation, and permits retry after settling', async () => {
    let confirm!: (value: boolean) => void
    confirmAction.mockImplementationOnce(() => new Promise<boolean>(resolve => { confirm = resolve }))
    const mutate = vi.fn<LnkResultMutate>()
    const { result } = renderHook(() => useHarness(pvkDraft(), mixedRows, { mutate }))
    act(() => result.current.setLnkResultLayeredControl(1, true))
    let saving!: Promise<void>
    act(() => { saving = result.current.handleAddLnkResult() })
    await act(async () => result.current.handleAddLnkResult())
    expect(confirmAction).toHaveBeenCalledOnce()
    expect(mutate).not.toHaveBeenCalled()
    await act(async () => { confirm(true); await saving })
    await act(async () => result.current.handleAddLnkResult())
    expect(mutate).toHaveBeenCalledOnce()
    act(() => mutate.mock.calls[0]![1]!.onSettled())
    await act(async () => result.current.handleAddLnkResult())
    expect(mutate).toHaveBeenCalledTimes(2)
  })

  it('assigns only the individually checked U-joint in a mixed save and never unsets stored assignments', async () => {
    const mutate = vi.fn<LnkResultMutate>()
    const { result } = renderHook(() => useHarness(pvkDraft(), mixedRows, { mutate }))
    act(() => result.current.setLnkResultLayeredControl(1, true))
    act(() => result.current.setLnkResultLayeredControl(3, true))
    act(() => result.current.setLnkResultLayeredControl(4, false))
    expect(result.current.draft.layeredControlRowIds).toEqual(new Set([1]))
    act(() => result.current.setLnkResultForRows([1], 'вырез'))
    expect(result.current.draft.result).toBe('годен')
    act(() => result.current.setLnkResultForRows([2], 'ремонт'))
    await act(async () => result.current.handleAddLnkResult())
    expect(confirmAction).toHaveBeenCalledOnce()
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ itemName: 'Новых назначений: 1' }))
    expect(mutate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ records: mixedRows, layeredControlRowIds: [1] }), expect.objectContaining({ onSettled: expect.any(Function) }))
    expect(mutate.mock.calls[0]![0].resultById).toEqual({ 1: 'годен', 2: 'ремонт', 3: 'годен', 4: 'годен' })
    expect(mutate.mock.calls[0]![0].records[3]?.layeredControlAssigned).toBe(true)
  })

  it('does not ask for a new assignment when only the stored locked mark remains', async () => {
    const mutate = vi.fn<LnkResultMutate>()
    const { result } = renderHook(() => useHarness(pvkDraft(), mixedRows, { mutate }))
    act(() => result.current.setLnkResultLayeredControl(1, true))
    act(() => result.current.setLnkResultLayeredControl(1, false))
    await act(async () => result.current.handleAddLnkResult())
    expect(confirmAction).not.toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ layeredControlRowIds: [] }), expect.objectContaining({ onSettled: expect.any(Function) }))
  })

  it('keeps choices on cancellation and sends no mutation', async () => {
    confirmAction.mockResolvedValue(false)
    const mutate = vi.fn<LnkResultMutate>()
    const { result } = renderHook(() => useHarness(pvkDraft(), mixedRows, { mutate }))
    act(() => result.current.setLnkResultLayeredControl(2, true))
    await act(async () => result.current.handleAddLnkResult())
    expect(mutate).not.toHaveBeenCalled()
    expect(result.current.draft.layeredControlRowIds).toEqual(new Set([2]))
  })

  it.each(['unselected', 'other-method', 'rejected'] as const)('cannot mark an ineligible row: %s', (reason) => {
    const draft = pvkDraft()
    if (reason === 'unselected') draft.rowIds.delete(1)
    if (reason === 'rejected') draft.result = 'вырез'
    const { result } = renderHook(() => useHarness(reason === 'other-method' ? { ...draft, methodKey: 'vikRequest' } : draft, mixedRows))
    act(() => result.current.setLnkResultLayeredControl(1, true))
    expect(result.current.draft.layeredControlRowIds.size).toBe(0)
  })

  it('changes only the context rows while preserving the shared result for the others', () => {
    const { result } = renderHook(() => useHarness())

    act(() => result.current.setLnkResultForRows([2], 'не годен'))

    expect(result.current.draft.result).toBe('__custom__')
    expect(result.current.draft.rowResults).toEqual({ 1: 'годен', 2: 'не годен' })
  })

  it('does not assign repair when any context row violates the repair rule', () => {
    const forbiddenRows = [rows[0], { ...rows[1], d1: 57, d2: 57 }] as WeldRow[]
    const initialDraft = { ...createDraft(), methodKey: 'rkRequest' as const }
    const { result } = renderHook(() => useHarness(initialDraft, forbiddenRows))

    act(() => result.current.setLnkResultForRows([1, 2], 'ремонт'))

    expect(result.current.draft).toEqual(initialDraft)
  })

  it.each(['vikRequest', 'pvkRequest'] as const)('accepts a small-diameter repair but rejects cutout for %s without rewriting the draft', (methodKey) => {
    const smallRows = rows.map((row) => ({ ...row, d1: 57 }))
    const { result } = renderHook(() => useHarness({ ...createDraft(), methodKey }, smallRows))
    act(() => result.current.setLnkResultForRows([1, 2], 'ремонт'))
    expect(result.current.draft.rowResults).toEqual({ 1: 'ремонт', 2: 'ремонт' })
    const before = result.current.draft
    act(() => result.current.setLnkResultForRows([1, 2], 'вырез'))
    expect(result.current.draft).toBe(before)
  })

  it('preserves and blocks an already stored forbidden draft instead of replacing it on save', async () => {
    const mutate = vi.fn<LnkResultMutate>()
    const draft = { ...createDraft(), result: 'вырез' }
    const { result } = renderHook(() => useHarness(draft, rows, { mutate }))
    await act(async () => result.current.handleAddLnkResult())
    expect(result.current.draft).toBe(draft)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('blocks new PVK repairs when pvkGoodOnly is enabled', () => {
    const draft = { ...createDraft(), methodKey: 'pvkRequest' as const }
    const { result } = renderHook(() => useHarness(draft, rows, { controlProcessSettings: { ...DEFAULT_CONTROL_PROCESS_SETTINGS, pvkGoodOnly: true } }))
    act(() => result.current.setLnkResultForRows([1, 2], 'ремонт'))
    expect(result.current.draft).toBe(draft)
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
