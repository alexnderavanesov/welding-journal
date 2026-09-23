import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useReportModalEscapeKey } from '@/lib/use-report-modal-escape-key'
import { setContextActionMenuOpen } from '@/lib/context-action-menu-state'

type EscapeKeyOptions = Parameters<typeof useReportModalEscapeKey>[0]

function createOptions(overrides: Partial<EscapeKeyOptions> = {}): EscapeKeyOptions {
  return {
    isReportModalOpen: true,
    isPstoRequestManagerOpen: false,
    isPstoResultManagerOpen: false,
    isLnkRequestManagerOpen: false,
    isLnkResultManagerOpen: false,
    isRkExposureModalOpen: true,
    isPstoResultModalOpen: false,
    isPstoRequestModalOpen: false,
    isLnkOfficialityModalOpen: false,
    isDuplicateControlModalOpen: false,
    isLnkResultModalOpen: false,
    isLnkRequestModalOpen: false,
    isReportImportModalOpen: false,
    canClosePstoRequestManager: true,
    canClosePstoResultManager: true,
    canCloseLnkRequestManager: true,
    canCloseLnkResultManager: true,
    canCloseRkExposureModal: true,
    onClosePstoRequestManager: vi.fn(),
    onClosePstoResultManager: vi.fn(),
    onCloseLnkRequestManager: vi.fn(),
    onCloseLnkResultManager: vi.fn(),
    onCloseRkExposureModal: vi.fn(),
    onClosePstoResultModal: vi.fn(),
    onClosePstoRequestModal: vi.fn(),
    onCloseLnkOfficialityModal: vi.fn(),
    onCloseDuplicateControlModal: vi.fn(),
    onCloseLnkResultModal: vi.fn(),
    onCloseLnkRequestModal: vi.fn(),
    onCloseReportImportModal: vi.fn(),
    ...overrides,
  }
}

function pressEscape() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
}

describe('useReportModalEscapeKey', () => {
  afterEach(() => {
    setContextActionMenuOpen(false)
    document.querySelectorAll('[data-confirm-action-dialog="true"]').forEach((node) => node.remove())
    document.querySelectorAll('[data-modal-dialog="true"]').forEach((node) => node.remove())
  })

  it('closes the RK exposure editor on Escape', () => {
    const onCloseRkExposureModal = vi.fn()
    const options = createOptions({ onCloseRkExposureModal })

    renderHook(() => useReportModalEscapeKey(options))
    pressEscape()

    expect(onCloseRkExposureModal).toHaveBeenCalledOnce()
  })

  it('does not close the RK exposure editor while it is saving', () => {
    const onCloseRkExposureModal = vi.fn()
    const options = createOptions({
      canCloseRkExposureModal: false,
      onCloseRkExposureModal,
    })

    renderHook(() => useReportModalEscapeKey(options))
    pressEscape()

    expect(onCloseRkExposureModal).not.toHaveBeenCalled()
  })

  it('leaves Escape for a confirmation dialog opened above the editor', () => {
    const onCloseRkExposureModal = vi.fn()
    const confirmationMarker = document.createElement('div')
    confirmationMarker.dataset.confirmActionDialog = 'true'
    document.body.append(confirmationMarker)
    const options = createOptions({ onCloseRkExposureModal })

    renderHook(() => useReportModalEscapeKey(options))
    pressEscape()

    expect(onCloseRkExposureModal).not.toHaveBeenCalled()
  })

  it('leaves the first Escape for a context menu opened above the editor', () => {
    const onCloseRkExposureModal = vi.fn()
    setContextActionMenuOpen(true)

    renderHook(() => useReportModalEscapeKey(createOptions({ onCloseRkExposureModal })))
    pressEscape()

    expect(onCloseRkExposureModal).not.toHaveBeenCalled()
  })

  it('closes the active pre-TO workflow before an underlying report dialog', () => {
    const onClosePreHeatTreatmentWorkflow = vi.fn()
    const onCloseRkExposureModal = vi.fn()

    renderHook(() => useReportModalEscapeKey(createOptions({
      isPreHeatTreatmentWorkflowOpen: true,
      onClosePreHeatTreatmentWorkflow,
      onCloseRkExposureModal,
    })))
    pressEscape()

    expect(onClosePreHeatTreatmentWorkflow).toHaveBeenCalledOnce()
    expect(onCloseRkExposureModal).not.toHaveBeenCalled()
  })

  it('closes the active TVMT workflow on Escape', () => {
    const onCloseTvmtWorkflow = vi.fn()

    renderHook(() => useReportModalEscapeKey(createOptions({
      isRkExposureModalOpen: false,
      isTvmtWorkflowOpen: true,
      onCloseTvmtWorkflow,
    })))
    pressEscape()

    expect(onCloseTvmtWorkflow).toHaveBeenCalledOnce()
  })

  it('closes the dispatcher workspace on Escape without closing a report action underneath', () => {
    const onCloseDispatcherWorkspace = vi.fn()
    const onCloseRkExposureModal = vi.fn()
    const { rerender } = renderHook(
      (options: EscapeKeyOptions) => useReportModalEscapeKey(options),
      { initialProps: createOptions({
        isRkExposureModalOpen: false,
        isDispatcherWorkspaceOpen: true,
        onCloseDispatcherWorkspace,
        onCloseRkExposureModal,
      }) },
    )
    pressEscape()
    expect(onCloseDispatcherWorkspace).toHaveBeenCalledOnce()
    expect(onCloseRkExposureModal).not.toHaveBeenCalled()

    rerender(createOptions({
      isRkExposureModalOpen: true,
      isDispatcherWorkspaceOpen: true,
      onCloseDispatcherWorkspace,
      onCloseRkExposureModal,
    }))
    pressEscape()
    expect(onCloseRkExposureModal).toHaveBeenCalledOnce()
    expect(onCloseDispatcherWorkspace).toHaveBeenCalledOnce()
  })

  it('leaves Escape to an independent picture or editor above the dispatcher', () => {
    const onCloseDispatcherWorkspace = vi.fn()
    const workspace = document.createElement('div')
    const child = document.createElement('div')
    workspace.dataset.modalDialog = 'true'
    child.dataset.modalDialog = 'true'
    document.body.append(workspace, child)
    renderHook(() => useReportModalEscapeKey(createOptions({
      isRkExposureModalOpen: false,
      isDispatcherWorkspaceOpen: true,
      onCloseDispatcherWorkspace,
    })))

    pressEscape()
    expect(onCloseDispatcherWorkspace).not.toHaveBeenCalled()
    child.remove()
    pressEscape()
    expect(onCloseDispatcherWorkspace).toHaveBeenCalledOnce()
  })
})
