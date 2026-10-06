import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createLnkDialogNavigation } from './lnk-dialog-navigation'
import { useHomeLnkController } from './use-home-lnk-controller'
import type { WeldRow } from './dispatcher-types'

function setup() {
  const actions = {
    closeLnkResultManager: vi.fn(), openLnkResultManager: vi.fn(),
    openAddLnkResultModal: vi.fn(), openAddLnkResultModalForRow: vi.fn(),
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
        closePreHeatTreatmentResultRegistryState: controller.closePreHeatTreatmentResultRegistry,
        controlProcessSettings: settings,
        lnkRows: [{ id: 1, joint: 'F1' }] as WeldRow[],
        tableActionRows: [], selectedLnkIds: new Set([1]),
        preHeatTreatmentResultCorrectionMutation: { isPending: false },
      }),
    }
  })
  return { result, actions, settings }
}

describe('LNK dialog navigation', () => {
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
