import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmActionProvider } from './confirm-action-context'
import { useManagedLnkResultActions } from './use-managed-lnk-result-actions'
import { useLnkResultManagerMutations } from './use-lnk-result-manager-mutations'
import { usePreHeatTreatmentResultEditActions } from './use-pre-heat-treatment-result-edit-actions'
import { buildLnkResultReplacementRows } from './lnk-result-correction-updates'
import { buildPreHeatTreatmentResultEditWrites, normalizePreHeatTreatmentResultEditBatch } from './pre-heat-treatment-result-edit-plan'
import type { WeldRow } from './dispatcher-types'
import type { UseLnkReportMutationsOptions } from './lnk-report-mutation-types'

const mocks = vi.hoisted(() => ({ primary: vi.fn(), pre: vi.fn() }))
vi.mock('./weld-save-utils', () => ({ updateWeldRowsOrThrow: mocks.primary }))
vi.mock('@/server/pre-heat-treatment-lnk-workflow', () => ({ savePreHeatTreatmentLnkResultEdits: mocks.pre }))
vi.mock('./weld-query-utils', () => ({ scheduleWeldDataRefresh: vi.fn() }))

beforeEach(() => { localStorage.clear(); mocks.primary.mockReset(); mocks.pre.mockReset() })

const row = (id: number, extra: Partial<WeldRow> = {}): WeldRow => ({
  id, rowVersion: `v${id}`, joint: `F${id}`, projectTitle: 'Test', subtitleCode: 'DWG', line: 'L',
  officiality: 'действующий', hasVik: 'да', vikResult: 'годен', vikRequest: 'V', vikRequestDate: '2026-09-01',
  vikConclusion: 'VC', vikConclusionDate: '2026-09-02', hasUzk: 'да', uzkRequest: 'U', uzkRequestDate: '2026-09-02',
  uzkResult: 'ремонт', uzkConclusion: 'UC', uzkConclusionDate: '2026-09-03', ...extra,
})
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client },
    createElement(ConfirmActionProvider, { children }))
}
function primaryHarness(rows: WeldRow[]) {
  const message = vi.fn(), closed = vi.fn(), renamed = vi.fn()
  const rendered = renderHook(({ currentRows }: { currentRows: WeldRow[] }) => {
    const [draft, setDraft] = useState<Record<string, string | null>>({})
    const mutations = useLnkResultManagerMutations({ setMessage: message, highlightChangedRows: vi.fn(),
      setManagedLnkPendingResultChanges: setDraft, setManagedLnkResultChangeHint: vi.fn(),
    } as unknown as UseLnkReportMutationsOptions)
    const actions = useManagedLnkResultActions({
      isLnkRowsContextReady: true, lnkRows: currentRows, selectedLnkResultRowIds: new Set(),
      managedLnkPendingResultChanges: draft, managedLnkPendingResultRows: [],
      ...mutations, lnkConclusionCorrectionMutation: { mutate: renamed },
      setMessage: message, setIsLnkResultModalOpen: vi.fn(), setIsLnkResultManagerOpen: closed,
      setManagedLnkResultMethodKey: vi.fn(), setManagedLnkConclusionDrafts: vi.fn(), setManagedLnkResultOrderIds: vi.fn(),
      setManagedLnkResultTargetKey: vi.fn(), setManagedLnkResultChangeHint: vi.fn(), setManagedLnkPendingResultChanges: setDraft,
    })
    return { draft, actions, mutations }
  }, { initialProps: { currentRows: rows }, wrapper: wrapper() })
  return { ...rendered, message, closed, renamed }
}
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Применить изменения' }))
const cancel = () => fireEvent.click(screen.getByRole('button', { name: 'Вернуться к редактированию' }))

describe('primary staged result edits', () => {
  it('keeps hidden methods/rows and first-touch versions through refresh and confirmation cancellation', async () => {
    const first = row(1), second = row(2, { uzkResult: 'годен' })
    const h = primaryHarness([first, second])
    act(() => h.result.current.actions.replaceLnkResult(first, 'uzkRequest', 'годен'))
    act(() => h.result.current.actions.clearLnkResult(second, 'uzkRequest'))
    expect(mocks.primary).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => h.result.current.actions.changeManagedLnkResultMethod('vikRequest'))
    h.rerender({ currentRows: [{ ...first, rowVersion: 'refreshed', uzkResult: 'вырез' }] })
    expect(h.result.current.actions.allManagedLnkPendingResultRows).toHaveLength(2)
    let pending!: Promise<void>
    act(() => { pending = h.result.current.actions.saveManagedLnkResultChanges() })
    expect(screen.getByText('F1')).toBeInTheDocument()
    expect(screen.getByText('F2')).toBeInTheDocument()
    cancel()
    await act(async () => pending)
    expect(h.result.current.draft).toEqual({ '1:uzkRequest': 'годен', '2:uzkRequest': null })
    expect(mocks.primary).not.toHaveBeenCalled()
    expect(h.closed).not.toHaveBeenCalled()
    mocks.primary.mockImplementation(async records => records)
    act(() => { pending = h.result.current.actions.saveManagedLnkResultChanges() })
    confirm()
    await act(async () => pending)
    await waitFor(() => expect(h.closed).toHaveBeenCalledWith(false))
    expect(mocks.primary).toHaveBeenCalledOnce()
    const saved = mocks.primary.mock.calls[0][0] as WeldRow[]
    expect(saved).toEqual([expect.objectContaining({ id: 1, rowVersion: 'v1', uzkResult: 'годен', uzkConclusion: 'UC' }),
      expect.objectContaining({ id: 2, rowVersion: 'v2', uzkResult: null, uzkConclusion: null, uzkConclusionDate: null, uzkRequest: 'U' })])
  })

  it('stale batch failure preserves all choices and editor; reset clears without closing, close discards', async () => {
    const first = row(1), second = row(2, { uzkResult: 'годен' })
    mocks.primary.mockRejectedValue(new Error('Версия устарела. Ничего не сохранено.'))
    const h = primaryHarness([first, second])
    act(() => h.result.current.actions.replaceLnkResult(first, 'uzkRequest', 'годен'))
    act(() => h.result.current.actions.clearLnkResult(second, 'uzkRequest'))
    let pending!: Promise<void>
    act(() => { pending = h.result.current.actions.saveManagedLnkResultChanges() })
    confirm(); await act(async () => pending)
    await waitFor(() => expect(h.message).toHaveBeenCalledWith('Версия устарела. Ничего не сохранено.'))
    expect(h.result.current.draft).toEqual({ '1:uzkRequest': 'годен', '2:uzkRequest': null })
    expect(h.closed).not.toHaveBeenCalled()
    act(() => h.result.current.actions.resetManagedLnkResultChanges())
    expect(h.result.current.draft).toEqual({})
    expect(h.closed).not.toHaveBeenCalled()
    const refreshed = { ...first, rowVersion: 'new-v1' }
    act(() => h.result.current.actions.clearLnkResult(refreshed, 'uzkRequest'))
    expect(h.result.current.actions.allManagedLnkPendingResultRows[0].row.rowVersion).toBe('new-v1')
    act(() => h.result.current.actions.closeLnkResultManager())
    expect(h.result.current.draft).toEqual({})
    expect(h.closed).toHaveBeenCalledWith(false)
    expect(mocks.primary).toHaveBeenCalledOnce()
  })

  it('choosing the factual result unstages deletion; unrelated requisites are never saved in batch', () => {
    const first = row(1)
    const h = primaryHarness([first])
    act(() => h.result.current.actions.clearLnkResult(first, 'uzkRequest'))
    act(() => h.result.current.actions.renameManagedLnkConclusionForRow(first, 'uzkRequest', 'UNSAVED'))
    expect(h.renamed).not.toHaveBeenCalled()
    act(() => h.result.current.actions.replaceLnkResult(first, 'uzkRequest', 'ремонт'))
    expect(h.result.current.draft).toEqual({})
    expect(mocks.primary).not.toHaveBeenCalled()
  })

  it('rejects protected deletion in a mixed package before calling the server', async () => {
    const first = row(1), protectedRow = row(2, { officiality: 'неофициальный' })
    const h = primaryHarness([first, protectedRow])
    act(() => h.result.current.actions.replaceLnkResult(first, 'uzkRequest', 'годен'))
    act(() => h.result.current.actions.clearLnkResult(protectedRow, 'uzkRequest'))
    await act(async () => h.result.current.actions.saveManagedLnkResultChanges())
    expect(h.message).toHaveBeenCalledWith(expect.stringContaining('неофициальн'))
    expect(mocks.primary).not.toHaveBeenCalled()
    expect(h.result.current.draft).toEqual({ '1:uzkRequest': 'годен', '2:uzkRequest': null })
  })

  it('merges different methods into one versioned weld record, clearing only deleted method requisites', () => {
    const first = row(1, { hasRk: 'да', rkResult: 'годен', rkRequest: 'R', rkRequestDate: '2026-09-02',
      rkConclusion: 'RC', rkConclusionDate: '2026-09-03' })
    const result = buildLnkResultReplacementRows({ updates: [
      { record: first, methodKey: 'uzkRequest', result: 'годен' }, { record: first, methodKey: 'rkRequest', result: null },
    ] })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ rowVersion: 'v1', uzkResult: 'годен', uzkConclusion: 'UC',
      rkResult: null, rkConclusion: null, rkConclusionDate: null, rkRequest: 'R', vikConclusion: 'VC' })
  })
})

const preRow = (id: number, result = 'ремонт'): WeldRow => row(id, { preHeatTreatmentLnkEnabled: true,
  preHeatTreatmentControls: [{ id: id * 10, weldJointId: id, method: 'ВИК', requestName: 'PRE', requestDate: '2026-09-01',
    result, conclusionName: 'PRE-C', conclusionDate: '2026-09-02' }] })
function preHarness() {
  const closed = vi.fn(), message = vi.fn()
  const rendered = renderHook(({ isOpen }: { isOpen: boolean }) => usePreHeatTreatmentResultEditActions({
    isOpen, onClose: closed, setMessage: message, onSaved: vi.fn(),
  }), { initialProps: { isOpen: true }, wrapper: wrapper() })
  return { ...rendered, closed, message }
}

describe('before-TO staged result edits', () => {
  it('confirms all hidden edits with original versions and excludes unstaged metadata from its single RPC', async () => {
    const first = preRow(1), second = preRow(2, 'годен'), h = preHarness()
    act(() => h.result.current.stageResultChange(first, first.preHeatTreatmentControls![0],
      { result: 'годен', conclusionName: 'UNSAVED', conclusionDate: '2030-01-01' }))
    act(() => h.result.current.stageResultChange(second, second.preHeatTreatmentControls![0], null))
    const refreshed = { ...first, rowVersion: 'refreshed' }
    act(() => h.result.current.stageResultChange(refreshed, refreshed.preHeatTreatmentControls![0],
      { result: 'годен', conclusionName: 'UNSAVED', conclusionDate: '2030-01-01' }))
    expect(h.result.current.pendingResultChanges['10']).toMatchObject({ conclusionName: 'PRE-C', conclusionDate: '2026-09-02' })
    let pending!: Promise<void>
    act(() => { pending = h.result.current.saveChanges() })
    cancel(); await act(async () => pending)
    expect(h.result.current.pendingResultCount).toBe(2)
    expect(mocks.pre).not.toHaveBeenCalled()
    mocks.pre.mockResolvedValue([first, second])
    act(() => { pending = h.result.current.saveChanges() })
    confirm(); await act(async () => pending)
    expect(mocks.pre).toHaveBeenCalledOnce()
    expect(mocks.pre.mock.calls[0][0].data.changes).toEqual([
      { rowId: 1, relationId: 10, expectedVersion: 'v1', result: 'годен' },
      { rowId: 2, relationId: 20, expectedVersion: 'v2', result: null },
    ])
    expect(h.result.current.pendingResultCount).toBe(0)
    expect(h.closed).toHaveBeenCalledOnce()
  })

  it('keeps the editor and entire draft on error; reset stays open; closing drops all ephemeral state', async () => {
    const first = preRow(1), h = preHarness()
    mocks.pre.mockRejectedValue(new Error('Стык изменён. Ничего не сохранено.'))
    act(() => h.result.current.stageResultChange(first, first.preHeatTreatmentControls![0], null))
    let pending!: Promise<void>
    act(() => { pending = h.result.current.saveChanges() })
    confirm(); await act(async () => pending)
    expect(h.message).toHaveBeenCalledWith('Стык изменён. Ничего не сохранено.')
    expect(h.result.current.pendingResultChanges).toEqual({ '10': null })
    expect(h.closed).not.toHaveBeenCalled()
    act(() => h.result.current.resetChanges())
    expect(h.closed).not.toHaveBeenCalled()
    expect(h.result.current.pendingResultCount).toBe(0)
    act(() => h.result.current.stageResultChange(first, first.preHeatTreatmentControls![0], null))
    act(() => h.result.current.discardAndClose())
    expect(h.result.current.pendingResultCount).toBe(0)
    expect(h.closed).toHaveBeenCalledOnce()
  })

  it('builds mixed results preserving request/waiting semantics and leaves another shared position unchanged', () => {
    const first = preRow(1), second = preRow(2, 'годен'), untouched = preRow(3, 'годен')
    const { writes, finalRows } = buildPreHeatTreatmentResultEditWrites({ rows: [first, second, untouched], changes: [
      { rowId: 1, relationId: 10, expectedVersion: 'v1', result: 'годен' },
      { rowId: 2, relationId: 20, expectedVersion: 'v2', result: null },
    ] })
    expect(writes[1]).toMatchObject({ id: 20, result: 'ожидает НК', requestName: 'PRE', requestDate: '2026-09-01', conclusionName: null, conclusionDate: null })
    expect(finalRows[2]).toEqual(untouched)
    expect(first.preHeatTreatmentControls![0].result).toBe('ремонт')
  })

  it('rejects the entire plan when a removal is protected by a later PSTO request', () => {
    const first = preRow(1), second = { ...preRow(2, 'годен'), pstoRequest: 'PSTO', pstoRequestDate: '2026-09-03' }
    expect(() => buildPreHeatTreatmentResultEditWrites({ rows: [first, second], changes: [
      { rowId: 1, relationId: 10, expectedVersion: 'v1', result: 'годен' },
      { rowId: 2, relationId: 20, expectedVersion: 'v2', result: null },
    ] })).toThrow('ПСТО')
    expect(first.preHeatTreatmentControls![0].result).toBe('ремонт')
  })

  it('rejects duplicate identities, inconsistent weld versions and oversized packages', () => {
    const change = { rowId: 1, relationId: 10, expectedVersion: 'v1', result: null }
    expect(() => normalizePreHeatTreatmentResultEditBatch({ changes: [change, change] })).toThrow('повторяется')
    expect(() => normalizePreHeatTreatmentResultEditBatch({ changes: [change, { ...change, relationId: 11, expectedVersion: 'v2' }] })).toThrow('разные исходные версии')
    expect(() => normalizePreHeatTreatmentResultEditBatch({ changes: Array.from({ length: 5001 }, (_, i) => ({ ...change, rowId: i + 1, relationId: i + 1 })) })).toThrow('5000')
    expect(() => normalizePreHeatTreatmentResultEditBatch({ changes: Array(20001).fill(change) })).toThrow('20000')
  })
})
