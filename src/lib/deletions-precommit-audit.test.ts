import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmActionProvider } from './confirm-action-context'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from './control-process-settings'
import type { WeldRow } from './dispatcher-types'
import { getRetainedChainDependants } from './joint-chain-deletion'
import { captureProgramChainStates } from './line-program-chain-state'
import { buildOfficialityRestorationRenames } from './lnk-officiality-restoration'
import { applyPstoCycleCorrection } from './psto-cycle-corrections'
import { buildRepeatPstoRequestCycle } from './psto-repeat-cycle-updates'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'
import { getUnofficialLnkResultIssues } from './unofficial-lnk-result-guard'
import { useManagedLnkResultActions } from './use-managed-lnk-result-actions'
import { useManagedLnkRequestActions } from './use-managed-lnk-request-actions'
import { useLnkRequestManagerMutation } from './use-lnk-request-manager-mutation'
import { defaultRequestNamingState } from './request-naming-state'
import { createRequestDocumentIdentity } from './request-document-identity'
import { assertCurrentInteractiveWeldRowVersions } from './weld-row-version'

const { manageRequest } = vi.hoisted(() => ({ manageRequest: vi.fn() }))
// Replace the network boundary only; the React Query observer and confirmation
// dialog are real, so changing props exercises the pending callback race.
vi.mock('@/server/weld-mutations-api', () => ({ manageLnkRequestDocument: manageRequest }))
vi.mock('@/lib/weld-query-utils', () => ({ scheduleWeldDataRefresh: vi.fn() }))

// Read-only audit regressions. No real server calls, database fixtures or migrations.
// Expectations follow the permanent deletion matrix (13.10.2026): cancellation
// preserves work, a reused name/sequence is not a reused object, guards survive.
const joint = (id: number, name: string, extra: Partial<WeldRow> = {}): WeldRow => ({
  id, projectTitle: 'Deletion audit', subtitleCode: 'AUD', line: 'L', joint: name, ...extra,
})

function confirmationWrapper({ children }: { children: ReactNode }) {
  return createElement(ConfirmActionProvider, { children })
}

function renderResultDeletion() {
  const record = joint(17, 'S17', { rowVersion: 'version-before-confirmation', hasUzk: 'да', uzkResult: 'годен' })
  const mutate = vi.fn()
  const initialDraft = { '17:uzkRequest': 'ремонт', '18:vikRequest': 'годен' }
  const hook = renderHook(() => {
    const [draft, setDraft] = useState<Record<string, string | null>>(initialDraft)
    const actions = useManagedLnkResultActions({
      isLnkRowsContextReady: true, lnkRows: [record], selectedLnkResultRowIds: new Set([17]),
      managedLnkPendingResultChanges: draft, managedLnkPendingResultRows: [],
      lnkResultReplacementMutation: { mutate },
      lnkConclusionCorrectionMutation: { mutate: vi.fn() },
      setMessage: vi.fn(), setIsLnkResultModalOpen: vi.fn(), setIsLnkResultManagerOpen: vi.fn(),
      setManagedLnkResultMethodKey: vi.fn(), setManagedLnkConclusionDrafts: vi.fn(),
      setManagedLnkResultOrderIds: vi.fn(), setManagedLnkResultTargetKey: vi.fn(),
      setManagedLnkResultChangeHint: vi.fn(), setManagedLnkPendingResultChanges: setDraft,
    })
    return { draft, actions }
  }, { wrapper: confirmationWrapper })
  return { ...hook, record, mutate, initialDraft }
}

describe('operator deletion cancellation and identity', () => {
  // Superseded only by explicit user approval: deletion is now staged, and
  // confirmation belongs to saving the complete mixed batch.
  it('staging LNK result deletion makes no call or confirmation and retains other drafts', () => {
    const { result, record, mutate, initialDraft } = renderResultDeletion()
    act(() => { result.current.actions.clearLnkResult(record, 'uzkRequest') })
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mutate).not.toHaveBeenCalled()
    expect(result.current.draft).toEqual({ ...initialDraft, '17:uzkRequest': null })
  })

  it('reset removes staged deletion and unrelated drafts without a write', () => {
    const { result, record, mutate } = renderResultDeletion()
    act(() => { result.current.actions.clearLnkResult(record, 'uzkRequest') })
    act(() => { result.current.actions.resetManagedLnkResultChanges() })
    expect(mutate).not.toHaveBeenCalled()
    expect(result.current.draft).toEqual({})
  })

  it('a stale callback cannot address a new weld that reuses the deleted weld name', () => {
    expect(() => assertCurrentInteractiveWeldRowVersions({
      targetIds: [17], expectedVersions: [{ id: 17, version: 'old' }],
      currentVersions: [{ id: 18, joint: 'S17', version: 'new' }],
    })).toThrow('Ничего не сохранено')
  })

  it('request deletion cannot silently adopt a new membership while confirmation is open', async () => {
    manageRequest.mockReset().mockResolvedValue([])
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const request = createRequestDocumentIdentity('Deletion audit request', '2026-09-01')!
    const first = joint(17, 'S17', { rowVersion: 'v1', vikRequest: request.name, vikRequestDate: request.date })
    const later = joint(18, 'S18', { rowVersion: 'v2', vikRequest: request.name, vikRequestDate: request.date })
    const { result, rerender, unmount } = renderHook(({ rows }: { rows: WeldRow[] }) => {
      const manager = useLnkRequestManagerMutation({
        lnkRows: rows, controlProcessSettings: DEFAULT_CONTROL_PROCESS_SETTINGS, lnkRequestOptions: [],
        setMessage: vi.fn(), setLnkNotice: vi.fn(), highlightChangedRows: vi.fn(), setSelectedLnkIds: vi.fn(),
        setLnkRequestDraft: vi.fn(), setLnkRequestNaming: vi.fn(), setIsLnkRequestModalOpen: vi.fn(),
        setManagedLnkRequestName: vi.fn(), setManagedLnkRequestNameDraft: vi.fn(), setIsLnkRequestManagerOpen: vi.fn(),
        setIsLnkResultModalOpen: vi.fn(), setLnkResultDraft: vi.fn(), setLnkOfficialityDraft: vi.fn(),
        setIsLnkOfficialityModalOpen: vi.fn(), resetDismissedRepeatedJointTasks: vi.fn(),
        setManagedLnkPendingResultChanges: vi.fn(), setManagedLnkResultChangeHint: vi.fn(),
        setHeatTreatmentFieldEditing: vi.fn(), defaultLnkRequestNaming: defaultRequestNamingState,
        defaultLnkConclusionNaming: defaultRequestNamingState,
      })
      const actions = useManagedLnkRequestActions({
        lnkRows: rows,
        lnkRequestManagerOptions: [request], managedLnkRequestName: request.name, managedLnkRequestDate: request.date,
        managedLnkRequestNameDraft: request.name, lnkRequestCorrectionMutation: { mutate: vi.fn() },
        lnkRequestManagerMutation: manager, setIsLnkRequestManagerOpen: vi.fn(), setManagedLnkRequestName: vi.fn(),
        setManagedLnkRequestDate: vi.fn(), setManagedLnkRequestNameDraft: vi.fn(),
      })
      return { actions, manager }
    }, { initialProps: { rows: [first] }, wrapper: ({ children }) =>
      createElement(QueryClientProvider, { client }, createElement(ConfirmActionProvider, { children })) })
    try {
      let pending!: Promise<void>
      act(() => { pending = result.current.actions.deleteManagedLnkRequest() })
      // Simulate a remote addition followed by the normal query refresh.
      rerender({ rows: [first, later] })
      fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
      await act(async () => pending)
      await waitFor(() => expect(result.current.manager.isSuccess).toBe(true))
      expect(manageRequest).toHaveBeenCalledOnce()
      // The server must see the originally confirmed set, so its full-membership
      // version check refuses deleting the unseen newly added position.
      expect(manageRequest.mock.calls[0][0].data.expectedVersions).toEqual([{ id: 17, version: 'v1' }])
    } finally {
      unmount()
      client.clear()
    }
  })
})

describe('deletion leaves a usable physical chain without weakening guards', () => {
  it.each([4, 5, 6])('deleting sibling %i cannot implicate another side or suffix path', id => {
    const rows = [joint(1, 'S63Y1'), joint(2, 'S63Y1W1R1'), joint(3, 'S63Y1W2R1'),
      joint(4, 'S63Y1W1R2'), joint(5, 'S63Y1R1W1'), joint(6, 'S63Y2W1R1')]
    // Compare numeric IDs with numeric IDs; object matchers on number[] are vacuous.
    expect(getRetainedChainDependants(rows, new Set([id])).map(row => row.id)).not.toContain(3)
    expect(getRetainedChainDependants(rows, new Set([2])).map(row => row.id)).toContain(3)
  })

  it('deleting the coil sides keeps the stored physical replacement fact', () => {
    const rows = [joint(1, 'S1'), joint(2, 'S1Y1', { weldDate: '2026-09-01' }),
      joint(3, 'S1Y2', { weldDate: '2026-09-01' })]
    const before = captureProgramChainStates(rows)
    expect(before.get(1)).toMatchObject({ replacedByCoil: true, replacementCoilIds: [2, 3] })
    const remaining = [{ ...rows[0], programChainState: before.get(1) }]
    expect(captureProgramChainStates(remaining).get(1)).toEqual(before.get(1))
  })

  it('a deleted official namesake no longer obstructs restoring an empty legacy result', () => {
    const remaining = joint(17, 'S63W1R1', { officiality: 'неофициальный', uzkResult: 'ожидает НК' })
    const official = joint(18, 'S63W1R1', { uzkResult: 'годен' })
    expect(() => buildOfficialityRestorationRenames([remaining, official], [remaining], DEFAULT_SYSTEM_INDEX_SETTINGS))
      .toThrow('уже есть официальный стык')
    expect(buildOfficialityRestorationRenames([remaining], [remaining], DEFAULT_SYSTEM_INDEX_SETTINGS)).toEqual([])
    expect(remaining.uzkResult).toBe('ожидает НК')
  })

  it('a surviving moved child still protects the old source ID after namesake recreation', () => {
    const before = [joint(17, 'S1'), joint(18, 'S1W1'), joint(19, 'S1W1R1'), joint(20, 'S1W2R1')]
    const states = captureProgramChainStates(before)
    const rows = before.map(row => ({ ...row, programChainState: states.get(row.id),
      ...(row.id === 20 ? { joint: 'F99', line: 'Moved', officiality: 'неофициальный' } : {}) }))
    rows.push({ ...joint(21, 'S1W1R1'), programChainState: undefined })
    expect(getRetainedChainDependants(rows, new Set([19])).map(row => row.id)).toContain(20)
    expect(getRetainedChainDependants(rows, new Set([21])).map(row => row.id)).not.toContain(20)
  })
})

describe('last-rejection and repeat-cycle deletion recovery', () => {
  it('backfill cannot use a rejection removed by the same final merged write', () => {
    const before = joint(17, 'S17', { officiality: 'неофициальный', uzkResult: 'ремонт', vikResult: null })
    expect(getUnofficialLnkResultIssues({ ...before, vikResult: 'годен', uzkResult: null }, before).map(issue => issue.fieldKeys).flat())
      .toEqual(expect.arrayContaining(['vikResult', 'uzkResult']))
  })

  it('deleting the final repeat request permits a fresh cycle #2 but rejects the old cycle ID', () => {
    const original = joint(17, 'S17', {
      weldDate: '2026-08-01', pstoRequired: 'да', pstoRequest: 'P1', pstoRequestDate: '2026-08-02',
      pstoDate: '2026-08-03', heatTreatmentDiagram: 'D1', pstoResult: 'проведено',
      tvmtRequest: 'T1', tvmtRequestDate: '2026-08-04', tvmtResult: 'не годен',
      tvmtConclusion: 'TC1', tvmtConclusionDate: '2026-08-05',
      pstoRepeatCycles: [{ id: 41, weldJointId: 17, sequence: 2, pstoRequest: 'P2', pstoRequestDate: '2026-08-06' }],
    })
    const deleted = applyPstoCycleCorrection(original, { sequence: 2, cycleId: 41, stage: 'pstoRequest', action: 'delete' })
    expect(deleted.deletedRepeatCycleId).toBe(41)
    expect(deleted.row.pstoRepeatCycles).toEqual([])
    expect(deleted.row.tvmtConclusion).toBe('TC1')
    const fresh = buildRepeatPstoRequestCycle({ row: deleted.row, requestName: 'P2-new', requestDate: '2026-08-07' })
    expect(fresh).toEqual({ weldJointId: 17, sequence: 2, pstoRequest: 'P2-new', pstoRequestDate: '2026-08-07' })
    const recreated = { ...deleted.row, pstoRepeatCycles: [{ ...fresh, id: 42 }] }
    expect(() => applyPstoCycleCorrection(recreated, { sequence: 2, cycleId: 41, stage: 'pstoRequest', action: 'delete' }))
      .toThrow('Повторный цикл уже изменен')
    expect(recreated.pstoRepeatCycles[0].id).toBe(42)
  })
})
