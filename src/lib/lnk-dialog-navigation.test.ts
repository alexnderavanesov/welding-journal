import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createLnkDialogNavigation } from './lnk-dialog-navigation'
import { useHomeLnkController } from './use-home-lnk-controller'
import type { WeldRow } from './dispatcher-types'

function setup(canLeaveResultEditor: () => boolean = () => true, tableRows: WeldRow[] = []) {
  const actions = {
    closeLnkResultManager: vi.fn(), openLnkResultManager: vi.fn(),
    openAddLnkResultModalForRows: vi.fn(), openAddLnkResultModal: vi.fn(), openAddLnkResultModalForRow: vi.fn(),
    openCreateLnkRequestModal: vi.fn(), openCreateLnkRequestModalForRow: vi.fn(),
    openCreateLnkRequestModalForRows: vi.fn(), openExtendLnkRequestModalForRows: vi.fn(),
    openLnkRequestRegistry: vi.fn(), setMessage: vi.fn(), setSelectedLnkIds: vi.fn(),
  }
  const settings = { preHeatTreatmentLnkEnabled: true }
  const { result } = renderHook(() => {
    const controller = useHomeLnkController()
    return {
      controller,
      navigation: createLnkDialogNavigation({
        ...controller, ...actions,
        canLeaveResultEditor,
        closePreHeatTreatmentResultRegistryState: controller.closePreHeatTreatmentResultRegistry,
        controlProcessSettings: settings,
        lnkRows: tableRows.length ? tableRows : [{ id: 1, joint: 'F1' }] as WeldRow[],
        tableActionRows: tableRows, selectedLnkIds: new Set(tableRows.length ? tableRows.map(row => row.id) : [1]),
        preHeatTreatmentResultCorrectionMutation: { isPending: false },
      }),
    }
  })
  return { result, actions, settings }
}

describe('LNK dialog navigation', () => {
  it('passes the complete primary selection from the header into the same bulk result action', () => {
    const rows = [1, 2].map(id => ({ id, pstoRequired: 'нет', hasVik: 'да', vikRequest: 'R', vikRequestDate: '2026-09-01', vikResult: 'ожидает НК' }) as WeldRow)
    const { result, actions } = setup(() => true, rows)
    act(() => result.current.navigation.openAddLnkWorkflowResultFromHeader())
    expect(actions.openAddLnkResultModalForRows).toHaveBeenCalledWith(rows)
    expect(actions.openAddLnkResultModal).not.toHaveBeenCalled()
  })

  it('keeps multiple rows on a stage switch and still opens an empty editor without primary requests', () => {
    const rows = [1, 2].map(id => ({ id, vikRequest: 'R', vikRequestDate: '2026-09-01' }) as WeldRow)
    const selected = setup(() => true, rows)
    act(() => selected.result.current.navigation.switchLnkWorkflowStage('result', 'primary', [1, 2]))
    expect(selected.actions.openAddLnkResultModalForRows).toHaveBeenCalledWith(rows)
    const empty = setup()
    act(() => empty.result.current.navigation.switchLnkWorkflowStage('result', 'primary', [1]))
    expect(empty.actions.openAddLnkResultModal).toHaveBeenCalled()
    expect(empty.actions.openAddLnkResultModalForRows).not.toHaveBeenCalled()
  })

  it('refuses stage/new-workflow transitions before changing any editor state when result edits are pending', () => {
    const guard = vi.fn(() => false)
    const { result, actions } = setup(guard)
    act(() => {
      result.current.controller.setIsPreHeatTreatmentResultManagerOpen(true)
      result.current.controller.setPreHeatTreatmentResultManagerRowIds([1])
    })
    const navigation = result.current.navigation
    act(() => {
      navigation.openPrimaryLnkRegistryFromPreHeatTreatment()
      navigation.openAddLnkResultFromRegistry()
      navigation.switchLnkWorkflowStage('result', 'beforeHeatTreatment', [1])
      navigation.switchLnkWorkflowStage('result', 'primary', [1])
      navigation.openAddLnkWorkflowResultFromHeader()
      navigation.openCreateLnkWorkflowRequestForRows([{ id: 1 }])
      navigation.openAddLnkWorkflowResultForRow({ id: 1 })
      navigation.openAllLnkResultRegistry()
      navigation.openSelectedLnkResultRegistry()
      navigation.openLnkResultRegistryForRows([{ id: 1 }])
      navigation.openExactLnkResult({ id: 1 }, 'vikRequest')
      navigation.openCreateLnkWorkflowRequestForRow({ id: 1 })
    })
    expect(guard).toHaveBeenCalledTimes(12)
    expect(result.current.controller.isPreHeatTreatmentResultManagerOpen).toBe(true)
    expect(result.current.controller.preHeatTreatmentResultManagerRowIds).toEqual([1])
    expect(result.current.controller.preHeatTreatmentLnkWorkflowMode).toBeNull()
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled()
  })

  it('allows stage navigation again after pending changes are reset', () => {
    let hasPendingChanges = true
    const { result, actions } = setup(() => !hasPendingChanges)
    act(() => result.current.navigation.switchLnkWorkflowStage('result', 'beforeHeatTreatment', [1]))
    expect(result.current.controller.preHeatTreatmentLnkWorkflowMode).toBeNull()
    hasPendingChanges = false
    act(() => result.current.navigation.switchLnkWorkflowStage('result', 'beforeHeatTreatment', [1]))
    expect(result.current.controller.preHeatTreatmentLnkWorkflowMode).toBe('result')
    expect(actions.setSelectedLnkIds).toHaveBeenCalledWith(new Set([1]))
  })

  it('resets the all-results registry without losing the selected-only path', () => {
    const { result, actions } = setup()
    act(() => {
      result.current.controller.setLnkResultRegistrySearch('F7')
      result.current.controller.setLnkResultRegistryFilter('ремонт')
    })
    act(() => result.current.navigation.openAllLnkResultRegistry())
    expect(result.current.controller.lnkResultRegistrySearch).toBe('')
    expect(result.current.controller.lnkResultRegistryFilter).toBe('all')
    expect(actions.openLnkResultManager).toHaveBeenLastCalledWith({ rowIds: null })
    act(() => result.current.navigation.openSelectedLnkResultRegistry())
    expect(actions.openLnkResultManager).toHaveBeenLastCalledWith({ rowIds: [1] })
  })

  it('preserves selection and extension mode across stage navigation', () => {
    const { result, actions } = setup()
    act(() => result.current.navigation.switchLnkWorkflowStage('request', 'beforeHeatTreatment', [1], 'extend'))
    expect(actions.setSelectedLnkIds).toHaveBeenCalledWith(new Set([1]))
    expect(result.current.controller.preHeatTreatmentLnkWorkflowMode).toBe('request')
    expect(result.current.controller.preHeatTreatmentLnkRequestSubmitMode).toBe('extend')
    act(() => result.current.navigation.switchLnkWorkflowStage('request', 'primary', [1], 'extend'))
    expect(result.current.controller.preHeatTreatmentLnkWorkflowMode).toBeNull()
    expect(actions.openExtendLnkRequestModalForRows).toHaveBeenCalledWith([{ id: 1, joint: 'F1' }])
  })

  it('does not open a disabled pre-TO stage or silently replace an unknown result', () => {
    const { result, actions, settings } = setup()
    settings.preHeatTreatmentLnkEnabled = false
    act(() => result.current.navigation.switchLnkWorkflowStage('request', 'beforeHeatTreatment', [1]))
    expect(result.current.controller.preHeatTreatmentLnkWorkflowMode).toBeNull()
    expect(actions.setSelectedLnkIds).not.toHaveBeenCalled()
    expect(actions.setMessage).toHaveBeenLastCalledWith('НК до ТО выключен в настройках проекта.')
    act(() => result.current.navigation.openExactLnkResult({ id: 1, joint: 'F1' } as WeldRow, 'vikRequest'))
    expect(actions.openLnkResultManager).not.toHaveBeenCalled()
    expect(actions.setMessage).toHaveBeenLastCalledWith('Не удалось определить внесенный результат ЛНК')
  })
})
